-- +goose Up
CREATE TABLE network_routes (
    provider TEXT NOT NULL,
    location TEXT NOT NULL,
    route TEXT NOT NULL,
    measured_at TIMESTAMP NOT NULL,
    PRIMARY KEY (provider, location)
);

CREATE TABLE network_backends (
    owner TEXT NOT NULL,
    package TEXT NOT NULL,
    backends TEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    PRIMARY KEY (owner, package)
);

-- +goose Down
DROP TABLE network_backends;
DROP TABLE network_routes;
