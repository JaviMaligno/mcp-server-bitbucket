# Bitbucket MCP - Roadmap de Funcionalidades

## Resumen

Este documento describe las nuevas funcionalidades a implementar en el MCP de Bitbucket para mejorar la experiencia de desarrolladores y equipos DevOps.

---

## Estado Actual (v0.1.x)

### Funcionalidades Implementadas (18 herramientas)

| Categoría | Herramientas | Endpoints |
|-----------|--------------|-----------|
| **Repositorios** | `get_repository`, `create_repository`, `delete_repository`, `list_repositories`, `update_repository` | CRUD completo |
| **Pull Requests** | `create_pull_request`, `get_pull_request`, `list_pull_requests`, `merge_pull_request` | Crear, listar, obtener, mergear |
| **Pipelines** | `trigger_pipeline`, `get_pipeline`, `list_pipelines`, `get_pipeline_logs`, `stop_pipeline` | CI/CD completo |
| **Projects** | `list_projects`, `get_project` | Lectura |
| **Branches** | `list_branches`, `get_branch` | Lectura |

---

## Fase 1: Alta Prioridad (v0.2.0)

### 1.1 Commits y Diff

Fundamental para revisar cambios antes de deploy y debugging.

| Herramienta | Endpoint | Descripción |
|-------------|----------|-------------|
| `list_commits` | `GET /repositories/{workspace}/{repo}/commits` | Historial de commits de una rama |
| `get_commit` | `GET /repositories/{workspace}/{repo}/commit/{commit}` | Detalles de un commit específico |
| `compare_commits` | `GET /repositories/{workspace}/{repo}/diff/{spec}` | Diff entre dos commits/ramas |

**Parámetros clave:**
- `branch`: Filtrar por rama
- `include`/`exclude`: Filtrar commits
- `path`: Filtrar por archivo modificado

---

### 1.2 Commit Statuses (Build Status)

Integración con CI/CD externos y verificación de estado de builds.

| Herramienta | Endpoint | Descripción |
|-------------|----------|-------------|
| `get_commit_statuses` | `GET /repositories/{workspace}/{repo}/commit/{commit}/statuses` | Estados de CI/CD de un commit |
| `create_commit_status` | `POST /repositories/{workspace}/{repo}/commit/{commit}/statuses/build` | Reportar estado de build externo |

**Estados posibles:** `SUCCESSFUL`, `FAILED`, `INPROGRESS`, `STOPPED`

---

### 1.3 PR Comments y Reviews

Flujo completo de code review sin salir del CLI.

| Herramienta | Endpoint | Descripción |
|-------------|----------|-------------|
| `list_pr_comments` | `GET /repositories/{workspace}/{repo}/pullrequests/{pr_id}/comments` | Ver comentarios de un PR |
| `add_pr_comment` | `POST /repositories/{workspace}/{repo}/pullrequests/{pr_id}/comments` | Añadir comentario |
| `approve_pr` | `POST /repositories/{workspace}/{repo}/pullrequests/{pr_id}/approve` | Aprobar PR |
| `request_changes_pr` | `POST /repositories/{workspace}/{repo}/pullrequests/{pr_id}/request-changes` | Solicitar cambios |
| `get_pr_diff` | `GET /repositories/{workspace}/{repo}/pullrequests/{pr_id}/diff` | Ver diff del PR |
| `decline_pr` | `POST /repositories/{workspace}/{repo}/pullrequests/{pr_id}/decline` | Rechazar PR |
| `unapprove_pr` | `DELETE /repositories/{workspace}/{repo}/pullrequests/{pr_id}/approve` | Quitar aprobación |

---

### 1.4 Deployments y Environments

Monitoreo de qué está desplegado en cada ambiente.

| Herramienta | Endpoint | Descripción |
|-------------|----------|-------------|
| `list_environments` | `GET /repositories/{workspace}/{repo}/environments` | Listar environments (test, staging, prod) |
| `get_environment` | `GET /repositories/{workspace}/{repo}/environments/{env_uuid}` | Detalles de un environment |
| `list_deployment_history` | `GET /repositories/{workspace}/{repo}/environments/{env_uuid}/deployment_history` | Historial de deploys |

---

### 1.5 Webhooks

Automatización de configuración de integraciones.

| Herramienta | Endpoint | Descripción |
|-------------|----------|-------------|
| `list_webhooks` | `GET /repositories/{workspace}/{repo}/hooks` | Ver webhooks configurados |
| `create_webhook` | `POST /repositories/{workspace}/{repo}/hooks` | Crear webhook |
| `get_webhook` | `GET /repositories/{workspace}/{repo}/hooks/{uid}` | Obtener detalles de webhook |
| `delete_webhook` | `DELETE /repositories/{workspace}/{repo}/hooks/{uid}` | Eliminar webhook |

**Eventos soportados:**
- `repo:push`, `repo:fork`, `repo:commit_status_created`
- `pullrequest:created`, `pullrequest:updated`, `pullrequest:approved`, `pullrequest:merged`
- `issue:created`, `issue:updated`

---

## Fase 2: Prioridad Media (v0.3.0)

### 2.1 Tags

| Herramienta | Endpoint | Descripción |
|-------------|----------|-------------|
| `list_tags` | `GET /repositories/{workspace}/{repo}/refs/tags` | Listar tags |
| `create_tag` | `POST /repositories/{workspace}/{repo}/refs/tags` | Crear tag |
| `delete_tag` | `DELETE /repositories/{workspace}/{repo}/refs/tags/{name}` | Eliminar tag |

---

### 2.2 Branch Restrictions

| Herramienta | Endpoint | Descripción |
|-------------|----------|-------------|
| `list_branch_restrictions` | `GET /repositories/{workspace}/{repo}/branch-restrictions` | Ver reglas de protección |
| `create_branch_restriction` | `POST /repositories/{workspace}/{repo}/branch-restrictions` | Crear regla |
| `delete_branch_restriction` | `DELETE /repositories/{workspace}/{repo}/branch-restrictions/{id}` | Eliminar regla |

**Tipos de restricción:**
- `require_passing_builds_to_merge`
- `require_approvals_to_merge`
- `require_default_reviewer_approvals_to_merge`
- `push`, `force`, `delete`, `restrict_merges`

---

### 2.3 Branching Model

| Herramienta | Endpoint | Descripción |
|-------------|----------|-------------|
| `get_branching_model` | `GET /repositories/{workspace}/{repo}/branching-model` | Ver modelo configurado |
| `update_branching_model` | `PUT /repositories/{workspace}/{repo}/branching-model/settings` | Configurar modelo |

---

### 2.4 Source (Navegación de código)

| Herramienta | Endpoint | Descripción |
|-------------|----------|-------------|
| `get_file_content` | `GET /repositories/{workspace}/{repo}/src/{commit}/{path}` | Leer archivo |
| `list_directory` | `GET /repositories/{workspace}/{repo}/src/{commit}/{path}/` | Listar directorio |

---

### 2.5 Downloads (Artifacts)

| Herramienta | Endpoint | Descripción |
|-------------|----------|-------------|
| `list_downloads` | `GET /repositories/{workspace}/{repo}/downloads` | Ver artifacts |
| `upload_download` | `POST /repositories/{workspace}/{repo}/downloads` | Subir artifact |
| `delete_download` | `DELETE /repositories/{workspace}/{repo}/downloads/{filename}` | Eliminar artifact |

---

## Fase 3: Prioridad Baja (v0.4.0)

### 3.1 Issue Tracker

- `list_issues`, `create_issue`, `update_issue`, `get_issue`
- Útil para equipos que no usan Jira

### 3.2 Reports (Code Insights)

- Ver reportes de cobertura y análisis estático
- Integración con herramientas de calidad

### 3.3 Repository Permissions

- Gestionar permisos de usuarios/grupos
- Nueva API 2.0 de Bitbucket

---

## Plan de Implementación - Fase 1

### Checklist de Desarrollo

- [ ] **1. Commits y Diff**
  - [ ] Implementar `list_commits`
  - [ ] Implementar `get_commit`
  - [ ] Implementar `compare_commits`
  - [ ] Tests unitarios
  - [ ] Documentación

- [ ] **2. Commit Statuses**
  - [ ] Implementar `get_commit_statuses`
  - [ ] Implementar `create_commit_status`
  - [ ] Tests unitarios
  - [ ] Documentación

- [ ] **3. PR Comments y Reviews**
  - [ ] Implementar `list_pr_comments`
  - [ ] Implementar `add_pr_comment`
  - [ ] Implementar `approve_pr`
  - [ ] Implementar `request_changes_pr`
  - [ ] Implementar `get_pr_diff`
  - [ ] Implementar `decline_pr`
  - [ ] Implementar `unapprove_pr`
  - [ ] Tests unitarios
  - [ ] Documentación

- [ ] **4. Deployments**
  - [ ] Implementar `list_environments`
  - [ ] Implementar `get_environment`
  - [ ] Implementar `list_deployment_history`
  - [ ] Tests unitarios
  - [ ] Documentación

- [ ] **5. Webhooks**
  - [ ] Implementar `list_webhooks`
  - [ ] Implementar `create_webhook`
  - [ ] Implementar `get_webhook`
  - [ ] Implementar `delete_webhook`
  - [ ] Tests unitarios
  - [ ] Documentación

### Checklist de Release

- [ ] Actualizar versión en `pyproject.toml` a `0.2.0`
- [ ] Actualizar `README.md` con nuevas funcionalidades
- [ ] Actualizar `INSTALLATION.md` si es necesario
- [ ] Ejecutar tests completos
- [ ] Build del paquete
- [ ] Publicar en PyPI
- [ ] Crear tag de release en Git

---

## Métricas de Éxito

| Métrica | Objetivo |
|---------|----------|
| Herramientas totales | 18 → 38 (+20) |
| Cobertura CI/CD | Commits, statuses, deployments |
| Cobertura Code Review | Comments, approvals, diff |
| Automatización | Webhooks configurables |

---

## Referencias

- [Bitbucket Cloud REST API](https://developer.atlassian.com/cloud/bitbucket/rest/)
- [API Webhooks](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-webhooks/)
- [API Deployments](https://support.atlassian.com/bitbucket-cloud/docs/set-up-and-monitor-bitbucket-deployments/)
- [API Commit Statuses](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-commit-statuses/)
