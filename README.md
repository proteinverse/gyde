# GYDE: Guide Your Design and Engineering

**GYDE** is an open-source, web-based collaborative platform designed to make computational analyses of proteins and antibodies easily accessible to bench scientists. GYDE enables the exploration of sequence-structure-function relationships through a tightly integrated visual interface, offering researchers comprehensive exploration of protein functional determinants via real assay data or computational tools.

![GYDE Interface](docs/figures/figure1.png)
*Figure 1: GYDE layout showing the integrated MSA, Structure Viewer and Plotting panel. The selected sequence in the MSA viewer is used for structure visualization and highlighted in the plotting panel.*

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Docker Deployment](#docker-deployment)
- [Local Installation](#local-installation)
- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [Configuration](#configuration)
- [Usage Examples](#usage-examples)
- [Use Cases](#use-cases)
- [Documentation](#documentation)
- [Development](#development)
- [Contributing](#contributing)
- [Citation](#citation)
- [Troubleshooting](#troubleshooting)
- [Future Directions](#future-directions)
- [License](#license)
- [Acknowledgments](#acknowledgments)
- [Contact](#contact)

## Overview 

GYDE addresses the challenge of adopting rapidly evolving computational tools in protein science and drug discovery. The platform provides:

- **No-code interface**: Access cutting-edge AI models without programming knowledge
- **Integrated visualization**: Synchronous views of sequence, structure, and functional data
- **Collaborative workflows**: Share analysis sessions with colleagues via intuitive hyperlinks
- **Extensible architecture**: Easy integration of new computational tools via the Slivka compute API

## Key Features

### Core Capabilities

- **Multiple Sequence Alignment (MSA) Viewer**: Interactive alignment visualization with filtering, sorting, annotation, and highlighting
- **3D Structure Visualization**: Integrated Mol* viewer with automatic sequence-structure synchronization
- **Interactive Plotting**: Histograms and scatter plots with bidirectional selection between plots and sequences
- **Frequency Analysis**: Analyze amino acid distributions at selected positions or conservation levels
- **Heatmap Visualization**: Navigate complex saturation mutagenesis datasets
- **Sequence Logo**: Integrated sequence logo viewer for protein variability analysis
- **Image Viewer**: View computational summaries and experimental images (e.g., SPR sensograms, AlphaFold confidence plots)

### Computational Tools Integration

Examples of GYDE integrations with state-of-the-art tools via the Slivka compute API:

**Structure Prediction:**
- AlphaFold2, Boltz-1/2, Chai-1r, OpenFold3
- ABodyBuilder2, Ibex (antibody-specific)
- MOE Ab_workflow

**Protein Design:**
- ProteinMPNN (inverse folding)
- ThermoMPNN (stability-focused design)
- LigandMPNN (ligand-conditioned design)
- BindCraft, RFDiffusion (de novo design)

**Analysis Tools:**
- MAFFT (multiple sequence alignment)
- Absolve (antibody numbering)
- RaSP, Rosetta ΔΔG (stability prediction)
- Therapeutic Antibody Profiler (TAP), MolDesk (Ab developability)   

### Data Management

- Flexible columnar dataframe model supporting sequences, structures, and experimental data
- Integration with public databases (PDB, UniProt, Pfam)
- Session persistence with versioning and access control
- "Send-to-GYDE" API for programmatic data import

## Docker Deployment

### Software Requirements

- Docker Engine with Docker Buildx and Docker Compose, **or** Podman with podman-compose
- Git (for dependencies installed from git repositories)
- At least 8GB of memory allocated to Docker/Podman containers

**Podman Users**: GYDE works with Podman. Install `podman` and `podman-compose`, initialize a machine with sufficient memory (`podman machine init --memory 8192`), then replace `docker compose` with `podman-compose` in the commands below.

### Setup Instructions

1. **Clone the repository:**
```bash
git clone https://github.com/proteinverse/gyde.git
cd gyde
```

2. **Designate an empty directory for Slivka data files and set the environment variable:**
```bash
export SLIVKA_DATA_DIR=/path/to/slivka/data
```

3. **Install Slivka-bio configurations and dependencies:**
```bash
docker compose --profile setup run slivka-bio-installer
```
   - The `--profile setup` flag is required to access the installer service
   - Follow the prompts to install services
   - By default, Docker installation method is used for each service
   - If prompted, confirm overwriting existing files

4. **Start the GYDE server:**
```bash
docker compose up gyde-server
```

The application will be available at `http://localhost:3030`

## Local Installation

### Prerequisites

- **Node.js** (v14 or higher)
- **MongoDB** (v4.4 or higher)
- **npm** or **yarn**
- **Git** (for dependencies installed from git repositories)

### Local Development Setup

1. **Clone the repository:**
```bash
git clone https://github.com/proteinverse/gyde.git
cd gyde
```

2. **Install frontend dependencies:**
```bash
cd gyde-frontend
npm install
```

3. **Install backend dependencies:**
```bash
cd ../gydesrv
npm install
```

4. **Set up MongoDB** (ensure MongoDB is running locally or configure connection string)

## Quick Start

### Development Mode

1. **Start the frontend development server:**
```bash
cd gyde-frontend
npm start
```
The application will be available at `http://localhost:3000`

2. **Optionally, configure Slivka URL:**
```bash
export SLIVKA_URL=http://your-slivka-server:4040
```

### Production Deployment

1. **Build the frontend:**
```bash
cd gyde-frontend
npm run build
```

2. **Start the backend server:**
```bash
cd ../gydesrv
npm install
export GYDE_HOST=0.0.0.0
export GYDE_PORT=3030
export GYDE_SLIVKA_URL=http://your-slivka-server:4040
export GYDE_MONGO_CONNECTION=mongodb://localhost:27017/
node index.js
```

The application will be available at `http://localhost:3030`

## Architecture

GYDE is built using a modular architecture with three main components:

![GYDE Architecture](docs/figures/figure2.png)
*Figure 2: GYDE architectural components showing the integration between GYDE frontend, backend, databases, Slivka and third-party integration.*

### Components

1. **GYDE Frontend** (`gyde-frontend/`): React-based web application providing the user interface
   - Multiple sequence alignment viewer
   - Mol* structure visualization
   - Interactive plotting and analysis tools
   - Session management UI

2. **GYDE Server** (`gydesrv/`): Node.js/Express backend server
   - Handles API requests and data management
   - Integrates with Slivka compute API for running computational tools
   - Manages MongoDB database connections
   - Provides OAuth2 authentication

3. **Slivka Integration**: Compute API for running bioinformatics tools
   - Supports various job schedulers (LSF, Slurm, SunGrid Engine)
   - Enables easy addition of new computational tools
   - Handles job queuing and result retrieval

### Data Flow

```
User Interface (React) 
    ↕
GYDE Server (Node.js/Express)
    ↕
MongoDB (Data Storage) + Slivka (Compute API)
    ↕
External Tools (AlphaFold, ProteinMPNN, etc.)
```

## Configuration

### Environment Variables

#### Backend (gydesrv)

| Variable | Description | Default |
|----------|-------------|---------|
| `GYDE_HOST` | Address to bind listening socket | `127.0.0.1` |
| `GYDE_PORT` | Port to bind listening socket | `3030` |
| `GYDE_SLIVKA_URL` | URL for Slivka backend API | **Required** |
| `GYDE_SLIVKA2_URL` | Secondary Slivka URL (fallback) | Same as `GYDE_SLIVKA_URL` |
| `GYDE_MONGO_CONNECTION` | MongoDB connection string | `mongodb://localhost/` |
| `GYDE_STATIC_DIR` | Directory for static content | `../gyde-frontend/build` |
| `GYDE_DB_NAME` | MongoDB database name | `gydedb_prd` (or `gydedb_dev` for dev) |
| `GYDE_ENV` | Environment mode (`dev` or `prod`) | Auto-detected from port |

#### Authentication (OAuth2)

| Variable | Description |
|----------|-------------|
| `GYDE_MOCK_USER` | Fake username for local/test (disables login) |
| `GYDE_OAUTH_BASE_URI` | URL where GYDE is running (for OAuth redirects) |
| `GYDE_OAUTH_ISSUER` | URL of your OAuth server |
| `GYDE_OAUTH_CLIENT` | OAuth client ID |
| `GYDE_OAUTH_SECRET` | OAuth client secret |

**Note**: GYDE supports any OAuth2-based authentication system. Development has primarily used AWS Cognito, but other providers should work.

#### SSL / CA Certificates

| Variable | Description | Default |
|----------|-------------|---------|
| `GYDE_CA_BUNDLE` | Path to a CA certificate bundle (PEM) for outbound HTTPS | *(none)* |

GYDE's Slivka containers make outbound HTTPS requests (e.g. to the ColabFold MSA server at `api.colabfold.com`). On networks that perform SSL inspection (corporate proxies, VPNs), these requests will fail with `CERTIFICATE_VERIFY_FAILED` unless the inspecting CA certificate is trusted.

**If you have a corporate CA certificate**, set `GYDE_CA_BUNDLE` to its path on the host and mount it into the scheduler container. In `docker-compose.yaml`, uncomment the CA bundle volume mount under `slivka-scheduler` and set the environment variable:
```bash
export GYDE_CA_BUNDLE=/path/to/corporate-ca-bundle.pem
```
Then in `docker-compose.yaml` under `slivka-scheduler.volumes`, uncomment:
```yaml
- ${GYDE_CA_BUNDLE}:/certs/ca-bundle.pem:ro
```
And update the environment variable to point to the in-container path:
```yaml
- GYDE_CA_BUNDLE=/certs/ca-bundle.pem
```

**If no CA certificate is provided**, SSL verification is automatically disabled for these outbound requests so that structure prediction and other tools that depend on external APIs continue to work.

#### Frontend

| Variable | Description |
|----------|-------------|
| `SLIVKA_URL` | Slivka API server URL (for development) |

## Usage Examples

### Data Input Methods

1. **Upload Data File**: Upload CSV, XLSX, FASTA, or PDB files
2. **Enter Sequences**: Manually enter protein sequences (useful for AlphaFold predictions, Fab predictions, etc.)
3. **Sequence/Structure IDs**: Import by providing sequence or structure identifiers
4. **Send-to-GYDE API**: Programmatically push data from external applications

### Common Workflows

#### Structure Prediction Workflow
1. Upload sequences or enter them manually
2. Select sequences in the MSA viewer
3. Run AlphaFold2, Chai, or Boltz structure prediction
4. View predicted structures in the integrated Mol* viewer
5. Compare predictions with experimental structures

#### Antibody Engineering Workflow
1. Upload antibody sequences with experimental data
2. Use Absolve for antibody-specific numbering
3. View CDR regions and framework regions
4. Run ABodyBuilder2 for antibody structure prediction
5. Analyze developability using TAP or MolDesk
6. Design variants using ProteinMPNN or LigandMPNN

#### Protein Design Workflow
1. Upload a reference structure
2. Define design space (positions to vary)
3. Run ProteinMPNN or ThermoMPNN
4. Analyze design proposals using frequency analysis
5. Filter and select promising designs
6. Export picklist for synthesis

### Send-to-GYDE API

GYDE provides a programmatic interface for pushing data from external applications. See the [send-to-gyde documentation](send-to-gyde/README.md) for details.

Example:
```bash
curl -X POST http://localhost:3030/send-to-gyde \
  -F "session_data=@your-data.json"
```

## Use Cases

GYDE has been successfully applied in various protein science applications. The following case studies demonstrate the platform's capabilities:

### Structure Prediction: Protein-Protein Interaction Networks

![Interactome Dataset](docs/figures/figure3.jpg)
*Figure 3: GYDE navigation of the interactome dataset. (A) Screen shot of table and structure viewer with overlay of one AlphaFold2 prediction versus a known structure for the selected row. (B) Three GYDE plots by AlphaFold2-multimer prediction maximum confidence versus confidence standard deviation for 1381 potential protein complexes.*

GYDE was used to analyze 1381 potential protein-protein interactions from experimental proteomics data. The platform enabled rapid visualization and filtering of AlphaFold2-multimer predictions, allowing researchers to identify high-confidence interactions and prioritize targets for further experimental validation.

### Method Benchmarking: Co-folding Methods Comparison

![Runs-N-Poses Dataset](docs/figures/figure4.png)
*Figure 4: Exploring the results of the Runs_N_Poses dataset re-generated only on Boltz and Chai. (A) GYDE dataset to explore individual predictions showing superposition of predicted vs ground truth co-folding methods. (B) Prediction accuracy vs. training set similarity to validate the Runs_N_Poses results.*

GYDE facilitated the comparison of Boltz-1 and Chai-1r co-folding methods by enabling interactive exploration of prediction quality, filtering by metrics, and visual inspection of structural discrepancies through the integrated Mol* viewer.

### Antibody Engineering: Rational Design Workflows

![Antibody Design Workflow](docs/figures/figure5.png)
*Figure 5: GYDE enables antibody rational design workflows shown here mapped to the graphical interface. 1) set antibody numbering scheme. 2) choose a reference antibody for relative comparisons. 3) view a data column as a heatmap that is aligned to the residue numbers. 4) click a heatmap grid to dive deeper into sequence variabilities. 5) predict the antibody structure to review heatmap-sequence-data relationships. 6) select variants of interest to synthesize.*

GYDE streamlines antibody engineering by integrating antibody-specific annotation tools, structure prediction, heatmap visualization of variants, and picklist generation. The platform was used to analyze SARS-CoV2 antibody sequences from B-cell repertoires, identifying key residues for engineering.

### Antibody Engineering: Anti-PD-1 Design

![ProteinMPNN Design](docs/figures/figure6.png)
*Figure 6: The GYDE interface during ProteinMPNN sequence design of the anti-PD1 antibody heavy chain. The sequence viewer displays the proposed sequences from ProteinMPNN highlighting mutation occurrences. The structure viewer can be used to show the reference structure highlighting design positions or specific columnar selections. The Frequency Widget at lower left provides an interactive workbench to study mutation distributions at each site and make selections manually or based on these frequencies.*

GYDE was used to design mutants of an anti-PD-1 rabbit antibody using ProteinMPNN. The integrated workflow allowed rapid generation and selection of sequence designs, frequency analysis of mutations, and integration with experimental affinity data, resulting in a variant with improved properties.

### Protein Design: HyperTEV Engineering

![Tev Protease Design](docs/figures/figure7.jpg)
*Figure 7: GYDE implementation for a ProteinMPNN design workflow applied to engineering Tev protease. (A) Complex design space selections can be designated by sequence indices, confirmed in the structure viewer and simple dialog options control the algorithm run. (B) The design proposal output is viewed in the multiple sequence alignment including sequence logo, heat map, and sequence-associated meta data (e.g. design scores) and user data that can be used for sorting and filtering results. (C) The frequency widget allows interactive analysis and selection of key mutations and distributions.*

GYDE replicated the computational components of a published study that achieved ~20x improvement in catalytic efficiency for an engineered Tev protease. The platform's flexible design space selection, sequence logo visualization, and frequency analysis tools enabled efficient exploration of the mutational landscape.

### De Novo Design: LRRC15-binding Miniproteins

![De Novo Binder Design](docs/figures/figure8.png)
*Figure 8: GYDE enables de novo binder generation. (A) AAVs can be re-targeted to new receptors by eliminating existing glycan binding through mutagenesis and incorporating novel de novo binding motifs (in orange) into the AAV capsid protein. (B) Hotspots were manually defined on the surface of an AlphaFold model of LRRC15. (C) Experimental data can be merged into existing GYDE session using the "Merge datasets" feature which allows adding files or copy-paste table data and merging based on desired columns. (D) The resulting GYDE session with experimental data (VLP yield and mLRRC15 binding) alongside predicted structures of the binders and a table-view of all designs enable analyzing sequence-structure-function relationships.*

GYDE was used to design LRRC15-binding miniproteins for AAV capsid retargeting. The platform integrated BindCraft and RFDiffusion designs, merged experimental binding and VLP yield data, and enabled rapid analysis of sequence-structure-function relationships to identify promising candidates.

## Documentation

- HOW TO get started

Expand the "I want to ..." section on the home page and follow along!
![Getting Started](docs/figures/start.png)

- [Send-to-GYDE Protocol](send-to-gyde/README.md)

## Development

### Project Structure

```
gyde/
├── gyde-frontend/     # React frontend application
│   ├── src/
│   │   ├── analysis/  # Analysis tools (ProteinMPNN, RaSP, etc.)
│   │   ├── gmsa/      # Multiple sequence alignment viewer
│   │   ├── structureView/  # Mol* structure visualization
│   │   └── ...
│   └── package.json
├── gydesrv/           # Node.js backend server
│   ├── index.js       # Main server file
│   └── package.json
├── docker/            # Docker configuration files
├── send-to-gyde/      # Send-to-GYDE API examples
└── docs/              # Documentation and manuscripts
    └── figures/       # Figure images
```

### Building from Source

See [Development Guide](docs/DEVELOPMENT.md) for detailed development instructions.

### Running Tests

```bash
cd gyde-frontend
npm test
```

## Contributing

We welcome contributions!

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Citation

If you use GYDE in your research, please cite this repository.


*Note: Update with actual citation information once the manuscript is published*

## Troubleshooting

### Common Issues

**Frontend won't start:**
- Ensure Node.js version is 14 or higher
- Clear `node_modules` and reinstall: `rm -rf node_modules && npm install`

**Backend connection errors:**
- Verify MongoDB is running and accessible
- Check `GYDE_MONGO_CONNECTION` environment variable
- Ensure `GYDE_SLIVKA_URL` is correctly set

**Docker build fails:**
- Increase Docker memory limit to at least 8GB
- Ensure Docker Buildx is installed and enabled
- Check that git is available for dependencies

**Computational jobs not running:**
- Verify Slivka server is running and accessible
- Check Slivka service configuration
- Review job logs in Slivka interface

**Stale results after reinstalling Slivka or resetting `SLIVKA_DATA_DIR`:**

If you delete or recreate `SLIVKA_DATA_DIR`, the MongoDB volume still retains cached job records that reference files that no longer exist. This can cause errors such as `Missing response(s) with labels alignment` when running tools like MAFFT. Clear the stale caches:
```bash
# Clear GYDE job cache
docker exec gyde-mongodb-rs0-1 mongosh gydedb_prd --eval 'db.gyde_jobcache_v2.deleteMany({})'

# Clear Slivka job and file records
docker exec gyde-mongodb-rs0-1 mongosh slivka --eval 'db.jobs.deleteMany({}); db.files.deleteMany({})'
```
Replace `docker` with `podman` if using Podman.

**Structure prediction fails with `CERTIFICATE_VERIFY_FAILED`:**

Outbound HTTPS requests to external APIs (e.g. ColabFold MSA server) fail with SSL errors when running behind a corporate proxy that performs SSL inspection. Either provide your corporate CA certificate via `GYDE_CA_BUNDLE` (see [SSL / CA Certificates](#ssl--ca-certificates) above) or, if no certificate is available, rebuild the slivka image — SSL verification is automatically disabled when no CA bundle is found:
```bash
docker compose build slivka-server
docker compose down
docker compose up gyde-server
```

**Slivka scheduler fails to connect to MongoDB (Podman):**

On Podman, the Slivka scheduler may fail on startup with `Name does not resolve` errors due to a DNS race condition. The `slivka-scheduler` service in `docker-compose.yaml` includes `restart: on-failure` to handle this automatically. If the issue persists, do a full stack restart:
```bash
podman compose down
podman compose up gyde-server
```

## Future Directions

- Integration of Large Language Models (LLMs) for prompt-based access to GYDE capabilities
- Support for conformational dynamics and molecular dynamics trajectories
- Enhanced visualization capabilities for complex datasets
- Expanded integration with external data sources and LIMS systems

## License

Genentech Non-Commercial Software License

See [LICENSE](LICENSE) file for details.

## Acknowledgments

GYDE was developed at Genentech Research and Early Development by Thomas Down and Kiran Mukhyala with critical support, feedback and input from the Computational Structural Biology group, Mateusz Warowny, April Walker, Luigi D’Ascenzo, Donald Lee, Travis W. Bainbridge, Jack  Nicoludis and Seth Harris.

## Contact

- **Maintainer**: Kiran Mukhyala
- **Email**: [mukhyala@gmail.com]
- **Issues**: [GitHub Issues](https://github.com/proteinverse/gyde/issues)
- **Discussions**: [GitHub Discussions](https://github.com/proteinverse/gyde/discussions)

---

**GYDE** - Making computational protein science accessible to all researchers.
