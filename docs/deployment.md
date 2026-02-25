# Despliegue de git-bot en Kubernetes

Esta guía cubre las tres estrategias de despliegue disponibles en el repositorio:

| Estrategia | Directorio | Cuándo usarla |
|---|---|---|
| **Helm directo** | [`helm/`](../helm/) | CI/CD custom, scripts de deploy |
| **GitOps con ArgoCD** | [`argocd/`](../argocd/) | Pull deploy automático recomendado en producción |
| **Manifiestos raw** | [`kubernetes/`](../kubernetes/) | Debug, entornos sin Helm/ArgoCD |

---

## Arquitectura de despliegue

```
                  ┌──────────────────────────────────────────────┐
                  │              Kubernetes Cluster               │
                  │  Namespace: git-bot                          │
                  │                                              │
  GitHub          │  ┌──────────┐    ┌─────────┐               │
  Webhooks ──────►│  │ git-bot  │───►│ MongoDB │               │
                  │  │  :3000   │    │  :27017  │               │
                  │  └────┬─────┘    └─────────┘               │
                  │       │  REST API                           │
                  │  ┌────▼─────┐                              │
                  │  │ Grafana  │                              │
                  │  │  :3001   │                              │
                  │  └──────────┘                              │
                  └──────────────────────────────────────────────┘

  GitHub Actions ──► GHCR
    ├── Docker image: ghcr.io/<owner>/git-bot:<sha>
    └── Helm chart:   oci://ghcr.io/<owner>/charts/git-bot:<version>
```

---

## Prerrequisitos

- Kubernetes 1.27+
- `kubectl` configurado contra el clúster
- `helm` v3.12+ (para Helm y ArgoCD)
- Acceso a `ghcr.io` con permisos de `read:packages`

---

## 1 · Helm – Despliegue directo

### 1.1 Estructura del chart

```
helm/
├── Chart.yaml                      # Metadatos y dependencias
├── values.yaml                     # Valores por defecto
├── files/
│   └── dashboards/                 # Dashboards de Grafana (copiados por CI)
│       ├── dora.json
│       └── workflows.json
└── templates/
    ├── _helpers.tpl                # Funciones de plantilla
    ├── configmap.yaml              # Variables de entorno no sensibles
    ├── configmap-grafana-datasource.yaml  # Datasource Infinity (sidecar)
    ├── configmap-grafana-dashboards.yaml  # Dashboards (sidecar)
    ├── deployment.yaml             # Deployment de git-bot
    ├── ingress.yaml                # Ingress opcional
    ├── secret.yaml                 # Secret placeholder (usa existingSecret en prod)
    └── service.yaml                # Service de git-bot
```

**Subcharts incluidos** (gestionados via `Chart.yaml > dependencies`):

| Subchart | Versión | Registry |
|---|---|---|
| `bitnami/mongodb` | ~15.0 | `oci://registry-1.docker.io/bitnamicharts` |
| `grafana/grafana` | ~8.0 | `https://grafana.github.io/helm-charts` |

### 1.2 Primeros pasos

```bash
# 1. Descarga subcharts
helm dependency update helm/

# 2. Crea el namespace
kubectl create namespace git-bot

# 3. Crea el secret con las credenciales reales de la GitHub App
kubectl create secret generic git-bot-secret \
  --from-literal=APP_ID=<id> \
  --from-literal=WEBHOOK_SECRET=<secret> \
  --from-literal=DATABASE_URL=mongodb://git-bot-mongodb:27017/probot_metrics \
  --from-file=PRIVATE_KEY=./private-key.pem \
  -n git-bot

# 4. Crea el secret para pull de imagen privada en GHCR
kubectl create secret docker-registry ghcr-pull-secret \
  --docker-server=ghcr.io \
  --docker-username=<user> \
  --docker-password=<PAT> \
  -n git-bot

# 5. Instala el chart
helm upgrade --install git-bot helm/ \
  --namespace git-bot \
  --set existingSecret=git-bot-secret \
  --set image.repository=ghcr.io/<owner>/git-bot \
  --set image.tag=<sha-corto>
```

### 1.3 Instalar desde GHCR (tras publicación por CI)

```bash
# Autentícate en GHCR
helm registry login ghcr.io \
  --username <user> \
  --password <PAT>

# Instala directamente desde el OCI registry
helm upgrade --install git-bot \
  oci://ghcr.io/<owner>/charts/git-bot \
  --version 0.1.0 \
  --namespace git-bot \
  --set existingSecret=git-bot-secret \
  --set image.tag=<sha>
```

### 1.4 Valores clave

| Parámetro | Por defecto | Descripción |
|---|---|---|
| `image.repository` | `ghcr.io/epicuro/git-bot` | Imagen Docker de la app |
| `image.tag` | `latest` | Tag de la imagen |
| `existingSecret` | `""` | Secret externo con credenciales; vacío = placeholder |
| `config.logLevel` | `info` | Nivel de log |
| `config.incidentLabel` | `incident` | Label de issue para MTTR |
| `mongodb.enabled` | `true` | Activa el subchart de MongoDB |
| `grafana.enabled` | `true` | Activa el subchart de Grafana |
| `grafana.adminPassword` | `admin` | Contraseña admin (cambia en producción) |
| `ingress.enabled` | `false` | Activa Ingress para el webhook |

### 1.5 Dashboards de Grafana en el chart

El CI copia los dashboards de `grafana/dashboards/` a `helm/files/dashboards/` antes de empaquetar. Las plantillas `configmap-grafana-datasource.yaml` y `configmap-grafana-dashboards.yaml` crean ConfigMaps con etiquetas que el **sidecar de Grafana** auto-descubre y provisiona:

- `grafana_datasource: "1"` → provisiona el datasource Infinity con la URL interna del servicio git-bot
- `grafana_dashboard: "1"` → provisiona los dashboards DORA y Workflows

---

## 2 · GitOps con ArgoCD (pull deploy)

### 2.1 Cómo funciona

```
GitHub Push ──► GitHub Actions ──► GHCR (chart + imagen)
                                         │
                                   ArgoCD detecta
                                   nueva versión  │
                                         ▼
                                   kubectl apply
                                   (automático)
```

ArgoCD sondea el registry OCI de GHCR y aplica el chart cuando detecta una nueva versión publicada.

### 2.2 Instalar ArgoCD (si no está instalado)

```bash
kubectl create namespace argocd
kubectl apply -n argocd \
  -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
```

### 2.3 Registrar el OCI registry en ArgoCD

```bash
argocd repo add oci://ghcr.io/<owner>/charts \
  --type helm \
  --name ghcr-charts \
  --username <user> \
  --password <PAT>
```

### 2.4 Crear el secret de credenciales

```bash
kubectl create namespace git-bot
kubectl create secret generic git-bot-secret \
  --from-literal=APP_ID=<id> \
  --from-literal=WEBHOOK_SECRET=<secret> \
  --from-literal=DATABASE_URL=mongodb://git-bot-mongodb:27017/probot_metrics \
  --from-file=PRIVATE_KEY=./private-key.pem \
  -n git-bot
```

### 2.5 Aplicar el Application de ArgoCD

```bash
# Edita argocd/application.yaml: reemplaza <owner> por tu usuario/organización
kubectl apply -f argocd/application.yaml -n argocd
```

### 2.6 Verificar sincronización

```bash
argocd app get git-bot
argocd app sync git-bot          # sincronización manual si es necesario
argocd app wait git-bot --health
```

### 2.7 Actualizar la versión desplegada

Cuando el workflow de CI publica una nueva versión del chart, ArgoCD la detecta y sincroniza automáticamente. Para forzar una versión específica, edita `argocd/application.yaml`:

```yaml
spec:
  source:
    targetRevision: 0.2.0   # nueva versión
    helm:
      values: |
        image:
          tag: "abc1234"    # SHA del commit
```

---

## 3 · Manifiestos Kubernetes raw

Para entornos sin Helm ni ArgoCD, usa los manifiestos en `kubernetes/`.

### 3.1 Estructura

```
kubernetes/
├── kustomization.yaml        # Kustomize raíz (aplica todo en orden)
├── namespace.yaml
├── git-bot/
│   ├── configmap.yaml        # Variables no sensibles
│   ├── secret.yaml           # Plantilla de Secret (no aplicar directamente)
│   ├── deployment.yaml       # Deployment de la app
│   └── service.yaml          # Service ClusterIP :3000
├── mongodb/
│   ├── statefulset.yaml      # StatefulSet con volumeClaimTemplates
│   └── service.yaml          # Headless Service (DNS estable)
└── grafana/
    ├── pvc.yaml              # PersistentVolumeClaim 2Gi
    ├── configmap.yaml        # Datasource + provider de dashboards
    ├── configmap-dashboards.yaml  # Placeholder (poblar con kubectl)
    ├── deployment.yaml       # Deployment con initContainer (instala plugin)
    └── service.yaml          # Service ClusterIP :3001
```

### 3.2 Aplicar con Kustomize

```bash
# 1. Crea el secret real (antes de aplicar)
kubectl create secret generic git-bot-secret \
  --from-literal=APP_ID=<id> \
  --from-literal=WEBHOOK_SECRET=<secret> \
  --from-literal=DATABASE_URL=mongodb://mongodb:27017/probot_metrics \
  --from-file=PRIVATE_KEY=./private-key.pem \
  -n git-bot --dry-run=client -o yaml | kubectl apply -f -

# 2. Carga los dashboards de Grafana en el ConfigMap
kubectl create configmap grafana-dashboards \
  --from-file=dora.json=grafana/dashboards/dora.json \
  --from-file=workflows.json=grafana/dashboards/workflows.json \
  -n git-bot --dry-run=client -o yaml | kubectl apply -f -

# 3. Aplica todos los manifiestos con Kustomize
kubectl apply -k kubernetes/

# 4. Verifica el estado
kubectl get all -n git-bot
```

### 3.3 Aplicar componentes individuales

```bash
# Solo MongoDB
kubectl apply -f kubernetes/mongodb/ -n git-bot

# Solo la aplicación
kubectl apply -f kubernetes/git-bot/ -n git-bot

# Solo Grafana
kubectl apply -f kubernetes/grafana/ -n git-bot
```

### 3.4 Actualizar imagen de git-bot

```bash
kubectl set image deployment/git-bot \
  git-bot=ghcr.io/<owner>/git-bot:<nuevo-sha> \
  -n git-bot
```

---

## 4 · Pipeline CI/CD – Publicación del chart

El workflow [`.github/workflows/deploy.yaml`](../.github/workflows/deploy.yaml) ejecuta tres jobs en secuencia:

```
push a main
    │
    ├─► [build]          Build + push imagen Docker a GHCR
    │                    ghcr.io/<owner>/git-bot:<sha>
    │
    ├─► [publish-chart]  helm dep update → helm package → helm push
    │                    oci://ghcr.io/<owner>/charts/git-bot:<version>
    │
    └─► [deploy]         Placeholder para deploy real
                         (Helm upgrade / ArgoCD sync / kubectl)
```

**Disparadores:** cambios en `git-bot/**`, `helm/**`, `grafana/dashboards/**`, `docker-compose.yml`.

El job `publish-chart` sincroniza automáticamente los dashboards de `grafana/dashboards/` al directorio `helm/files/dashboards/` antes de empaquetar.

---

## 5 · Seguridad y secretos

> **Nunca versiones el archivo `.env` ni `private-key.pem` con valores reales.**

Para gestión de secretos en producción, considera:

- **[Sealed Secrets](https://github.com/bitnami-labs/sealed-secrets)** – cifra los secrets en el repositorio Git
- **[External Secrets Operator](https://external-secrets.io/)** – sincroniza desde Vault, AWS SM, etc.
- **[SOPS](https://github.com/getsops/sops)** – cifra archivos YAML/JSON directamente

```bash
# Ejemplo con Sealed Secrets
kubeseal < kubernetes/git-bot/secret.yaml \
  --controller-namespace kube-system \
  --format yaml > kubernetes/git-bot/sealed-secret.yaml
```

---

## 6 · Acceso a los servicios (port-forward)

```bash
# git-bot (webhook + API de métricas)
kubectl port-forward svc/git-bot 3000:3000 -n git-bot

# Grafana
kubectl port-forward svc/grafana 3001:3001 -n git-bot
# Abre http://localhost:3001 (admin / <password>)

# MongoDB (debug)
kubectl port-forward svc/mongodb 27017:27017 -n git-bot
```

---

## 7 · Verificación post-despliegue

```bash
# Estado general
kubectl get all -n git-bot

# Logs de la app
kubectl logs -l app.kubernetes.io/name=git-bot -n git-bot --follow

# Health check de la API
kubectl run curl --image=curlimages/curl -it --rm --restart=Never -n git-bot \
  -- curl -s http://git-bot:3000/metrics/health

# Métricas DORA (ejemplo)
kubectl run curl --image=curlimages/curl -it --rm --restart=Never -n git-bot \
  -- curl -s "http://git-bot:3000/metrics/dora/summary?days=30"
```
