import { useEffect, useLayoutEffect, useMemo, useRef, type ComponentRef } from "react";
import { applyProps, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei/core/OrbitControls";
import { BufferGeometry, Color, Float32BufferAttribute, Matrix4, PerspectiveCamera, type InstancedMesh, type LineLoop } from "three";
import { createPolygonShape, fitMassingCamera, type PreparedMassingScene, type PreparedPolygon } from "./massing3DGeometry";

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

function FloorStack({ building }: { building: NonNullable<PreparedMassingScene["building"]> }) {
  const mesh = useRef<InstancedMesh>(null);
  const shape = useMemo(() => createPolygonShape(building.floorPlate), [building.floorPlate]);
  const options = useMemo(() => ({ depth: building.floorHeight, bevelEnabled: false, steps: 1 }), [building.floorHeight]);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    const matrix = new Matrix4();
    const colors = [new Color("#326359"), new Color("#63988a")];
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
    <meshLambertMaterial />
  </instancedMesh>;
}

export default function Massing3DScene({ scene, reset, onContextLost }: {
  scene: PreparedMassingScene;
  reset: number;
  onContextLost: () => void;
}) {
  const { camera, gl, size, invalidate } = useThree();
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const fit = useMemo(() => fitMassingCamera(scene, Math.max(size.width, 1) / Math.max(size.height, 1)), [scene, size.width, size.height]);
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
    <color attach="background" args={["#f8faf9"]} />
    <ambientLight intensity={1.8} />
    <directionalLight position={[8, 12, 5]} intensity={2} />
    <ContextLayer polygons={scene.site} color="#50636a" elevation={0} />
    <ContextLayer polygons={scene.buildable} color="#71639d" dashed elevation={contextStep} />
    <ContextLayer polygons={scene.selectedBuildable} color="#297d91" elevation={contextStep * 2} />
    {scene.building && <>
      <FloorStack building={scene.building} />
      <ContextLayer polygons={[scene.building.footprint]} color="#204e44" elevation={contextStep * 3} />
    </>}
    <OrbitControls ref={controls} enablePan={false} enableDamping={false} minDistance={fit.minDistance}
      maxDistance={fit.maxDistance} minPolarAngle={0.05} maxPolarAngle={Math.PI / 2 - 0.02} />
  </>;
}
