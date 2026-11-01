import { useEffect, useLayoutEffect, useMemo, useRef, type ComponentRef } from "react";
import { applyProps, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei/core/OrbitControls";
import { Html } from "@react-three/drei/web/Html";
import { BufferGeometry, Color, Float32BufferAttribute, Matrix4, PerspectiveCamera, type Group, type InstancedMesh, type LineLoop } from "three";
import { createPolygonShape, fitMassingCamera, type PreparedMassingScene, type PreparedPolygon } from "./massing3DGeometry";
import styles from "./Massing3D.module.css";

type Building = NonNullable<PreparedMassingScene["building"]>;

function BoundaryRing({ ring, color, dashed = false, elevation = 0 }: {
  ring: PreparedPolygon["rings"][number];
  color: string;
  dashed?: boolean;
  elevation?: number;
}) {
  const line = useRef<LineLoop>(null);
  const geometry = useMemo(() => new BufferGeometry().setAttribute("position",
    new Float32BufferAttribute(ring.flatMap(([x, y]) => [x, elevation, -y]), 3)), [ring, elevation]);
  // Replacing only a BufferAttribute leaves its old GPU buffer outside the
  // geometry's disposal list. Replace and dispose the complete owned geometry.
  useEffect(() => () => geometry.dispose(), [geometry]);
  useLayoutEffect(() => { line.current?.computeLineDistances(); }, [geometry]);
  return <lineLoop ref={line} geometry={geometry}>
    {dashed
      ? <lineDashedMaterial color={color} dashSize={0.12} gapSize={0.08} />
      : <lineBasicMaterial color={color} />}
  </lineLoop>;
}

function ContextLayer({ polygons, color, dashed, elevation }: {
  polygons: PreparedPolygon[];
  color: string;
  dashed?: boolean;
  elevation: number;
}) {
  return <>{polygons.flatMap((polygon, polygonIndex) => polygon.rings.map((ring, ringIndex) => (
    <BoundaryRing key={`${polygonIndex}-${ringIndex}`} ring={ring} color={color} dashed={dashed} elevation={elevation} />
  )))}</>;
}

function FloorStack({ building }: { building: Building }) {
  const mesh = useRef<InstancedMesh>(null);
  const shape = useMemo(() => createPolygonShape(building.floorPlate), [building.floorPlate]);
  const options = useMemo(() => ({ depth: building.floorHeight, bevelEnabled: false, steps: 1 }), [building.floorHeight]);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    const matrix = new Matrix4();
    const colors = [new Color("#b7c9bc"), new Color("#c7d5c9")];
    building.floorElevations.forEach((elevation, index) => {
      mesh.current?.setMatrixAt(index, matrix.makeTranslation(0, 0, elevation));
      mesh.current?.setColorAt(index, colors[index % colors.length]);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
    mesh.current.computeBoundingSphere();
  }, [building]);
  // A single declarative geometry/material owns GPU allocation for all floors.
  // Instance IDs retain floor identity without rebuilding or disposing shared meshes.
  return <instancedMesh ref={mesh} args={[undefined, undefined, building.floorCount]} rotation={[-Math.PI / 2, 0, 0]}>
    <extrudeGeometry args={[shape, options]} />
    <meshStandardMaterial roughness={0.85} metalness={0} />
  </instancedMesh>;
}

function FloorBoundaries({ building }: { building: Building }) {
  const geometry = useMemo(() => {
    const positions: number[] = [];
    building.floorElevations.forEach((_, floor) => {
      const elevation = floor === building.floorCount - 1 ? building.totalHeight : building.floorElevations[floor + 1];
      for (const ring of building.floorPlate.rings) {
        ring.forEach(([x, y], index) => {
          const next = ring[(index + 1) % ring.length];
          positions.push(x, elevation, -y, next[0], elevation, -next[1]);
        });
      }
    });
    return new BufferGeometry().setAttribute("position", new Float32BufferAttribute(positions, 3));
  }, [building]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  // All floor and roof rings share one draw call, including courtyard boundaries.
  return <lineSegments geometry={geometry}>
    <lineBasicMaterial color="#607e70" transparent opacity={0.65} />
  </lineSegments>;
}

function HeightDimension({ building, label }: { building: Building; label: string }) {
  const group = useRef<Group>(null);
  const bounds = useMemo(() => {
    const ring = building.footprint.rings[0];
    return ring.reduce((box, [x, y]) => ({
      minX: Math.min(box.minX, x), maxX: Math.max(box.maxX, x),
      minZ: Math.min(box.minZ, -y), maxZ: Math.max(box.maxZ, -y),
    }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
  }, [building]);
  const gap = 0.4;
  const geometry = useMemo(() => new BufferGeometry().setAttribute("position", new Float32BufferAttribute([
    0, 0, 0, 0, building.totalHeight, 0,
    -0.09, 0, 0, 0.09, 0, 0,
    -0.09, building.totalHeight, 0, 0.09, building.totalHeight, 0,
  ], 3)), [building.totalHeight]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  // Run after OrbitControls and before Html projects the label in this demand frame.
  useFrame(({ camera }) => {
    if (!group.current) return;
    camera.updateMatrixWorld();
    const rightX = camera.matrixWorld.elements[0];
    const rightZ = camera.matrixWorld.elements[2];
    const length = Math.hypot(rightX, rightZ) || 1;
    const x = rightX / length;
    const z = rightZ / length;
    // Keep the marker on the near side as well as beyond camera-right so
    // perspective cannot hide it behind the building while orbiting.
    const offset = (bounds.maxX - bounds.minX) / 2 * Math.abs(x)
      + (bounds.maxZ - bounds.minZ) / 2 * Math.abs(z) + gap;
    const nearOffset = (bounds.maxX - bounds.minX) / 2 * Math.abs(z)
      + (bounds.maxZ - bounds.minZ) / 2 * Math.abs(x);
    group.current.position.set((bounds.minX + bounds.maxX) / 2 + x * offset - z * nearOffset, 0,
      (bounds.minZ + bounds.maxZ) / 2 + z * offset + x * nearOffset);
    group.current.rotation.y = Math.atan2(-z, x);
  }, -0.5);
  return <group ref={group}>
    <lineSegments geometry={geometry}><lineBasicMaterial color="#527364" /></lineSegments>
    <Html position={[0.22, building.totalHeight / 2, 0]} center style={{ pointerEvents: "none" }} zIndexRange={[1, 0]}>
      <span className={styles.heightLabel} aria-hidden="true">{label}</span>
    </Html>
  </group>;
}

export default function Massing3DScene({ scene, heightLabel, reset, onContextLost }: {
  scene: PreparedMassingScene;
  heightLabel: string | undefined;
  reset: number;
  onContextLost: () => void;
}) {
  const { camera, gl, size, invalidate } = useThree();
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const fit = useMemo(() => {
    // Reserve a little horizontal room for the nearby marker; model bounds and
    // normalized geometry remain unchanged, including for context-only scenes.
    const margin = scene.building ? 0.8 : 0;
    return fitMassingCamera({ ...scene, bounds: {
      min: [scene.bounds.min[0] - margin, scene.bounds.min[1], scene.bounds.min[2] - margin],
      max: [scene.bounds.max[0] + margin, scene.bounds.max[1], scene.bounds.max[2] + margin],
    } }, Math.max(size.width, 1) / Math.max(size.height, 1));
  }, [scene, size.width, size.height]);
  const contextStep = Math.min(0.002, (scene.building?.floorHeight ?? 1) / 100);

  useLayoutEffect(() => {
    if (!(camera instanceof PerspectiveCamera)) return;
    camera.position.set(...fit.position);
    applyProps(camera, { near: fit.near, far: fit.far });
    camera.lookAt(...fit.target);
    camera.updateProjectionMatrix();
    controls.current?.target.set(...fit.target);
    controls.current?.update();
    invalidate();
  }, [camera, fit, reset, invalidate]);

  useEffect(() => {
    const canvas = gl.domElement;
    // Fiber deliberately loses its context after unmount. Remove this listener
    // first so normal teardown cannot turn into a user-visible rendering failure.
    canvas.addEventListener("webglcontextlost", onContextLost);
    return () => canvas.removeEventListener("webglcontextlost", onContextLost);
  }, [gl, onContextLost]);

  return <>
    <color attach="background" args={["#f4f5f1"]} />
    <hemisphereLight args={["#ffffff", "#b5b9a9", 1.2]} />
    <directionalLight position={[8, 12, 5]} intensity={2.5} />
    <directionalLight position={[-6, 5, -3]} intensity={0.6} />
    <ContextLayer polygons={scene.site} color="#50636a" elevation={0} />
    <ContextLayer polygons={scene.buildable} color="#71639d" dashed elevation={contextStep} />
    <ContextLayer polygons={scene.selectedBuildable} color="#297d91" elevation={contextStep * 2} />
    {scene.building && <>
      <FloorStack building={scene.building} />
      <FloorBoundaries building={scene.building} />
      {heightLabel && <HeightDimension building={scene.building} label={heightLabel} />}
      <ContextLayer polygons={[scene.building.footprint]} color="#204e44" elevation={contextStep * 3} />
    </>}
    <OrbitControls ref={controls} enablePan={false} enableDamping={false} minDistance={fit.minDistance}
      maxDistance={fit.maxDistance} minPolarAngle={0.05} maxPolarAngle={Math.PI / 2 - 0.02} />
  </>;
}
