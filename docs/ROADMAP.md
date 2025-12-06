# Bitbucket MCP - Roadmap de Funcionalidades

## Resumen

Este documento describe las funcionalidades del MCP de Bitbucket y el plan para futuras mejoras.

---

## Estado Actual (v0.2.0) - 38 herramientas

### Funcionalidades Implementadas

| Categoría | Herramientas | Estado |
|-----------|--------------|--------|
| **Repositorios** | `get_repository`, `create_repository`, `delete_repository`, `list_repositories`, `update_repository` | v0.1.0 |
| **Pull Requests** | `create_pull_request`, `get_pull_request`, `list_pull_requests`, `merge_pull_request` | v0.1.0 |
| **Pipelines** | `trigger_pipeline`, `get_pipeline`, `list_pipelines`, `get_pipeline_logs`, `stop_pipeline` | v0.1.0 |
| **Projects** | `list_projects`, `get_project` | v0.1.0 |
| **Branches** | `list_branches`, `get_branch` | v0.1.0 |
| **Commits** | `list_commits`, `get_commit`, `compare_commits` | v0.2.0 |
| **Commit Statuses** | `get_commit_statuses`, `create_commit_status` | v0.2.0 |
| **PR Reviews** | `approve_pr`, `unapprove_pr`, `request_changes_pr`, `decline_pr`, `list_pr_comments`, `add_pr_comment`, `get_pr_diff` | v0.2.0 |
| **Deployments** | `list_environments`, `get_environment`, `list_deployment_history` | v0.2.0 |
| **Webhooks** | `list_webhooks`, `create_webhook`, `get_webhook`, `delete_webhook` | v0.2.0 |

---

## Fase 1: Alta Prioridad - COMPLETADA (v0.2.0)

### 1.1 Commits y Diff

| Herramienta | Estado | Descripción |
|-------------|--------|-------------|
| `list_commits` | DONE | Historial de commits de una rama |
| `get_commit` | DONE | Detalles de un commit específico |
| `compare_commits` | DONE | Diff entre dos commits/ramas |

---

### 1.2 Commit Statuses (Build Status)

| Herramienta | Estado | Descripción |
|-------------|--------|-------------|
| `get_commit_statuses` | DONE | Estados de CI/CD de un commit |
| `create_commit_status` | DONE | Reportar estado de build externo |

---

### 1.3 PR Comments y Reviews

| Herramienta | Estado | Descripción |
|-------------|--------|-------------|
| `list_pr_comments` | DONE | Ver comentarios de un PR |
| `add_pr_comment` | DONE | Añadir comentario |
| `approve_pr` | DONE | Aprobar PR |
| `unapprove_pr` | DONE | Quitar aprobación |
| `request_changes_pr` | DONE | Solicitar cambios |
| `decline_pr` | DONE | Rechazar PR |
| `get_pr_diff` | DONE | Ver diff del PR |

---

### 1.4 Deployments y Environments

| Herramienta | Estado | Descripción |
|-------------|--------|-------------|
| `list_environments` | DONE | Listar environments (test, staging, prod) |
| `get_environment` | DONE | Detalles de un environment |
| `list_deployment_history` | DONE | Historial de deploys |

---

### 1.5 Webhooks

| Herramienta | Estado | Descripción |
|-------------|--------|-------------|
| `list_webhooks` | DONE | Ver webhooks configurados |
| `create_webhook` | DONE | Crear webhook |
| `get_webhook` | DONE | Obtener detalles de webhook |
| `delete_webhook` | DONE | Eliminar webhook |

---

## Fase 2: Prioridad Media (v0.3.0) - PENDIENTE

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

## Fase 3: Prioridad Baja (v0.4.0) - PENDIENTE

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

## Historial de Releases

### v0.2.0 (2025-12-06)
- +20 nuevas herramientas
- Commits: `list_commits`, `get_commit`, `compare_commits`
- Commit Statuses: `get_commit_statuses`, `create_commit_status`
- PR Reviews: `approve_pr`, `unapprove_pr`, `request_changes_pr`, `decline_pr`, `list_pr_comments`, `add_pr_comment`, `get_pr_diff`
- Deployments: `list_environments`, `get_environment`, `list_deployment_history`
- Webhooks: `list_webhooks`, `create_webhook`, `get_webhook`, `delete_webhook`

### v0.1.x (2025-12)
- 18 herramientas iniciales
- Repositorios, PRs, Pipelines, Projects, Branches

---

## Métricas

| Métrica | v0.1.x | v0.2.0 | v0.3.0 (objetivo) |
|---------|--------|--------|-------------------|
| Herramientas | 18 | 38 | ~50 |
| Cobertura API | 40% | 70% | 85% |

---

## Referencias

- [Bitbucket Cloud REST API](https://developer.atlassian.com/cloud/bitbucket/rest/)
- [API Webhooks](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-webhooks/)
- [API Deployments](https://support.atlassian.com/bitbucket-cloud/docs/set-up-and-monitor-bitbucket-deployments/)
- [API Commit Statuses](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-commit-statuses/)
