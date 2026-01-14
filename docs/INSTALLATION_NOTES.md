# GYDE Installation Notes

This document captures observations and potential issues encountered during installation testing. Use this as a reference when troubleshooting installation problems.

## Docker Deployment Observations

### Prerequisites Not Clearly Documented

1. **SLIVKA_DATA_DIR environment variable**: This is required before running any `docker compose` commands, but it's only mentioned in step 1 of the Docker Deployment section, not in the Prerequisites section.

2. **8GB Memory Requirement**: The Docker memory requirement (at least 8GB) is mentioned as a note in the Docker Deployment section but should be checked before attempting installation.

3. **Service Execution Order**: The `slivka-bio-installer` must be run before `gyde-server` can function properly. This dependency isn't immediately obvious from the instructions.

### Docker-in-Docker (dind) Architecture

The GYDE Docker setup uses a Docker-in-Docker container to run computational tools. This architecture:
- Requires `privileged: true` mode for the dind container
- Uses TLS certificates shared between containers via the `dind-certs` volume
- May have compatibility issues with container alternatives like Podman

## Podman Compatibility

### Testing Results (January 2026)

**GYDE works successfully with Podman on macOS.** Testing was performed with:
- Podman 5.7.1 (installed via Homebrew)
- podman-compose 1.5.0
- Podman machine with 8GB RAM, 4 CPUs

All services started correctly and the GYDE web interface was accessible at http://localhost:3030.

### Setup for Podman (macOS)

```bash
# Install Podman and podman-compose
brew install podman podman-compose

# Initialize and start the Podman machine with sufficient resources
podman machine init --cpus 4 --memory 8192
podman machine start

# Set up GYDE
mkdir -p /path/to/slivka/data
export SLIVKA_DATA_DIR=/path/to/slivka/data
cd /path/to/gyde

# Build and run
podman-compose build
podman-compose --profile setup run slivka-bio-installer
podman-compose up gyde-server
```

### Notes on Podman Compatibility

1. **Docker-in-Docker**: The dind container (`docker:28.2.2-dind-alpine3.21`) works with Podman's Docker compatibility layer.

2. **Privileged Mode**: Podman handles the `privileged: true` setting correctly for the dind service.

3. **Volume Permissions**: No special flags were needed for volume mounts in testing.

4. **Profile Flag**: The `--profile setup` flag is required for the slivka-bio-installer command.

### Quick Start with Podman

```bash
# 1. Create data directory and set environment variable
mkdir -p /tmp/gyde-slivka-data
export SLIVKA_DATA_DIR=/tmp/gyde-slivka-data

# 2. Build all images
podman-compose build

# 3. Run the installer (note: --profile setup is required)
podman-compose --profile setup run slivka-bio-installer

# 4. Start the server (runs in foreground, use -d for background)
podman-compose up gyde-server

# 5. Access GYDE at http://localhost:3030

# To stop all services:
podman-compose down
```

## Installation Checklist

Before starting deployment:

- [ ] Docker Engine (with Buildx and Compose) **or** Podman (with podman-compose) installed
- [ ] At least 8GB memory allocated to Docker/Podman
- [ ] Git installed
- [ ] Empty directory created for `SLIVKA_DATA_DIR`
- [ ] `SLIVKA_DATA_DIR` environment variable exported

## Troubleshooting

### Build Fails with Memory Error

Increase Docker's memory allocation to at least 8GB in Docker Desktop settings or daemon configuration.

### MongoDB Connection Errors

The MongoDB replica set initialization may take a moment. Wait for the `mongodb-rs0-setup` service to complete successfully before the other services can connect.

### Slivka Server Not Healthy

Check that:
1. MongoDB is running and healthy
2. The `SLIVKA_DATA_DIR` contains the expected configuration after running the installer
3. Port 4040 is not already in use

### GYDE Server Not Starting

Ensure:
1. All dependent services are healthy (MongoDB, Slivka)
2. Port 3030 is not already in use
3. The frontend build completed successfully during image creation
