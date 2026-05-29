// ============================================================
// Workflow Templates
// ============================================================

export const TEMPLATES = [
  {
    id: 'node-ci',
    icon: '🟢',
    name: 'Node.js CI',
    lang: 'Node.js',
    desc: 'Run tests and build across multiple Node versions on push and pull_request.',
    yaml: `name: Node.js CI
on:
  push:
    branches: [ "main", "master" ]
  pull_request:
    branches: [ "main", "master" ]
jobs:
  build:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [18.x, 20.x, 22.x]
    steps:
      - uses: actions/checkout@v4
      - name: Use Node.js \${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: \${{ matrix.node-version }}
          cache: 'npm'
      - run: npm ci
      - run: npm run build --if-present
      - run: npm test`,
  },
  {
    id: 'python-ci',
    icon: '🐍',
    name: 'Python CI',
    lang: 'Python',
    desc: 'Test a Python package with pytest across multiple Python versions.',
    yaml: `name: Python CI
on:
  push:
    branches: [ "main" ]
  pull_request:
    branches: [ "main" ]
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python-version: ["3.10", "3.11", "3.12"]
    steps:
      - uses: actions/checkout@v4
      - name: Set up Python \${{ matrix.python-version }}
        uses: actions/setup-python@v5
        with:
          python-version: \${{ matrix.python-version }}
      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          pip install pytest
          if [ -f requirements.txt ]; then pip install -r requirements.txt; fi
      - name: Run tests
        run: pytest`,
  },
  {
    id: 'docker-publish',
    icon: '🐳',
    name: 'Docker Publish',
    lang: 'Docker',
    desc: 'Build and push a Docker image to GitHub Container Registry on push.',
    yaml: `name: Docker Publish
on:
  push:
    branches: [ "main" ]
    tags: [ 'v*.*.*' ]
  pull_request:
    branches: [ "main" ]
env:
  REGISTRY: ghcr.io
  IMAGE_NAME: \${{ github.repository }}
jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - name: Log in to Container Registry
        uses: docker/login-action@v3
        with:
          registry: \${{ env.REGISTRY }}
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}
      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: \${{ env.REGISTRY }}/\${{ env.IMAGE_NAME }}
      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: .
          push: \${{ github.event_name != 'pull_request' }}
          tags: \${{ steps.meta.outputs.tags }}
          labels: \${{ steps.meta.outputs.labels }}`,
  },
  {
    id: 'github-pages',
    icon: '📄',
    name: 'Deploy Pages',
    lang: 'GitHub Pages',
    desc: 'Build a static site and deploy it to GitHub Pages automatically.',
    yaml: `name: Deploy GitHub Pages
on:
  push:
    branches: [ "main" ]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: "pages"
  cancel-in-progress: false
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - name: Install dependencies
        run: npm ci
      - name: Build
        run: npm run build
      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: ./dist
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4`,
  },
  {
    id: 'java-maven',
    icon: '☕',
    name: 'Java Maven',
    lang: 'Java',
    desc: 'Build and test a Java project using Apache Maven with JDK 21.',
    yaml: `name: Java CI with Maven
on:
  push:
    branches: [ "main" ]
  pull_request:
    branches: [ "main" ]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Set up JDK 21
        uses: actions/setup-java@v4
        with:
          java-version: '21'
          distribution: 'temurin'
          cache: maven
      - name: Build with Maven
        run: mvn -B package --file pom.xml
      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: app-jar
          path: target/*.jar`,
  },
  {
    id: 'auto-release',
    icon: '🚀',
    name: 'Auto Release',
    lang: 'Release',
    desc: 'Automatically create a GitHub release with notes when a version tag is pushed.',
    yaml: `name: Create Release
on:
  push:
    tags:
      - 'v*'
jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - name: Build project
        run: |
          echo "Add your build commands here"
      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true
          files: |
            dist/*`,
  },
  {
    id: 'codeql',
    icon: '🔍',
    name: 'CodeQL Security',
    lang: 'Security',
    desc: 'Scan for security vulnerabilities using GitHub CodeQL on push and schedule.',
    yaml: `name: CodeQL Security Scan
on:
  push:
    branches: [ "main" ]
  pull_request:
    branches: [ "main" ]
  schedule:
    - cron: '30 1 * * 1'
jobs:
  analyze:
    runs-on: ubuntu-latest
    permissions:
      security-events: write
      actions: read
      contents: read
    strategy:
      fail-fast: false
      matrix:
        language: [ 'javascript-typescript', 'python' ]
    steps:
      - uses: actions/checkout@v4
      - name: Initialize CodeQL
        uses: github/codeql-action/init@v3
        with:
          languages: \${{ matrix.language }}
      - name: Autobuild
        uses: github/codeql-action/autobuild@v3
      - name: Perform CodeQL Analysis
        uses: github/codeql-action/analyze@v3
        with:
          category: "/language:\${{matrix.language}}"`,
  },
  {
    id: 'pr-quality',
    icon: '✅',
    name: 'PR Quality Checks',
    lang: 'Quality',
    desc: 'Run linting, unit tests, and coverage on every pull request with concurrency control.',
    yaml: `name: PR Quality Checks
on:
  pull_request:
    branches: [ "main", "develop" ]
concurrency:
  group: \${{ github.workflow }}-\${{ github.event.pull_request.number }}
  cancel-in-progress: true
jobs:
  lint:
    name: Lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run lint
  test:
    name: Test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm test -- --coverage
      - uses: codecov/codecov-action@v4`,
  },
  {
    id: 'go-ci',
    icon: '🔵',
    name: 'Go CI',
    lang: 'Go',
    desc: 'Build, vet, and test a Go application across multiple versions.',
    yaml: `name: Go CI
on:
  push:
    branches: [ "main" ]
  pull_request:
    branches: [ "main" ]
jobs:
  build:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        go-version: ['1.21', '1.22']
    steps:
      - uses: actions/checkout@v4
      - name: Set up Go \${{ matrix.go-version }}
        uses: actions/setup-go@v5
        with:
          go-version: \${{ matrix.go-version }}
          cache: true
      - name: Build
        run: go build -v ./...
      - name: Vet
        run: go vet ./...
      - name: Test
        run: go test -v ./...`,
  },
]
