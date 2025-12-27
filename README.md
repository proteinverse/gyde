# GYDE

An app for protein design and sequence-structure-activity analysis.

## getting started

```
cd gyde-frontend
npm install
```

## to run the app
```
cd gyde-frontend
npm start
```

Optionally, you can set the `SLIVKA_URL` environment variable to specify a Slivka
API server other than the detail.

## Production deployment

```
cd gyde-frontend
npm run build
cd ../gydesrv
npm install
export GYDE_HOST=0.0.0.0
node index.js
```

## Docker

### Software requirements

You need docker engine, docker buildx and docker compose installed. Follow the
[Docker docs](https://docs.docker.com/) for instructions.

Building GYDE requires more memory than the Docker host is configured to allocate to
containers by default. Raise the memory limit to 8GB before building the GYDE image.

Additionally, you need a recent version of git, as some dependencies are installed
directly form git repositories.

### Installing slivka-bio

First, designate an empty directory for slivka data files. The docker will mount
that directory inside the containers and store the slivka configuration files and
job data there. Set the `SLIVKA_DATA_DIR` variable to that path and export it.

Install, slivka-bio configurations and dependencies:

1. Execute `docker compose run slivka-bio-installer`. 
   - If you want to use a different version of the installen than the one cloned during the build
     process, add `-v </path/to/slivka-bio-installer>:/usr/src/slivka-bio-installer` after the `run`
2. The installer will list all services and prompt if you want to replace the existing directory.
   Answer yes [y].
3. By default the default installation method (docker) is used for each service. 
4. If you had slivka already installed in the specified directory, you may be prompted to
   overwrite some of the files.

### Running GYDE server

Simply run `docker compose up gyde-server`

