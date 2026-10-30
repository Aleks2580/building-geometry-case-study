CREATE TABLE options (
    id uuid PRIMARY KEY,
    parent_id uuid REFERENCES options(id) ON DELETE RESTRICT,
    name text,
    schema_version integer NOT NULL CHECK (schema_version > 0),
    algorithm_version text NOT NULL CHECK (length(algorithm_version) > 0),
    site_geometry jsonb NOT NULL,
    hard_constraints jsonb NOT NULL,
    preferences jsonb NOT NULL,
    targets jsonb NOT NULL,
    result jsonb NOT NULL,
    feasibility_status text NOT NULL CHECK (
        feasibility_status IN (
            'feasible', 'feasible_target_unmet', 'infeasible', 'generation_failed'
        )
    ),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT options_result_status_check CHECK (
        result -> 'feasibility' ->> 'status' IS NOT NULL
        AND feasibility_status = result -> 'feasibility' ->> 'status'
    )
);

CREATE INDEX options_parent_id_idx ON options(parent_id);
CREATE INDEX options_created_at_idx ON options(created_at, id);
