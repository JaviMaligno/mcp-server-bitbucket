# Bitbucket MCP - Roadmap de Funcionalidades

## Resumen

Este documento describe las funcionalidades del MCP de Bitbucket y el plan para futuras mejoras.

---

## Estado Actual (v0.3.0) - 54 herramientas

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
| **Tags** | `list_tags`, `create_tag`, `delete_tag` | v0.3.0 |
| **Branch Restrictions** | `list_branch_restrictions`, `create_branch_restriction`, `delete_branch_restriction` | v0.3.0 |
| **Source** | `get_file_content`, `list_directory` | v0.3.0 |
| **Repository Permissions** | `list_user_permissions`, `get_user_permission`, `update_user_permission`, `delete_user_permission`, `list_group_permissions`, `get_group_permission`, `update_group_permission`, `delete_group_permission` | v0.3.0 |

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

## Fase 2: Prioridad Media - COMPLETADA (v0.3.0)

### 2.1 Tags

| Herramienta | Estado | Descripción |
|-------------|--------|-------------|
| `list_tags` | DONE | Listar tags |
| `create_tag` | DONE | Crear tag |
| `delete_tag` | DONE | Eliminar tag |

---

### 2.2 Branch Restrictions

| Herramienta | Estado | Descripción |
|-------------|--------|-------------|
| `list_branch_restrictions` | DONE | Ver reglas de protección |
| `create_branch_restriction` | DONE | Crear regla |
| `delete_branch_restriction` | DONE | Eliminar regla |

**Tipos de restricción soportados:**
- `require_passing_builds_to_merge`
- `require_approvals_to_merge`
- `require_default_reviewer_approvals_to_merge`
- `push`, `force`, `delete`, `restrict_merges`

---

### 2.3 Source (Navegación de código)

| Herramienta | Estado | Descripción |
|-------------|--------|-------------|
| `get_file_content` | DONE | Leer archivo sin clonar |
| `list_directory` | DONE | Listar directorio |

---

### 2.4 Repository Permissions (adelantado de Fase 3)

| Herramienta | Estado | Descripción |
|-------------|--------|-------------|
| `list_user_permissions` | DONE | Listar permisos de usuarios |
| `get_user_permission` | DONE | Ver permiso de un usuario |
| `update_user_permission` | DONE | Añadir/actualizar permiso |
| `delete_user_permission` | DONE | Eliminar permiso de usuario |
| `list_group_permissions` | DONE | Listar permisos de grupos |
| `get_group_permission` | DONE | Ver permiso de un grupo |
| `update_group_permission` | DONE | Añadir/actualizar permiso de grupo |
| `delete_group_permission` | DONE | Eliminar permiso de grupo |

---

## Fase 3: Prioridad Baja (v0.4.0) - PENDIENTE

### 3.1 Branching Model

| Herramienta | Endpoint | Descripción |
|-------------|----------|-------------|
| `get_branching_model` | `GET /repositories/{workspace}/{repo}/branching-model` | Ver modelo configurado |
| `update_branching_model` | `PUT /repositories/{workspace}/{repo}/branching-model/settings` | Configurar modelo |

---

### 3.2 Downloads (Artifacts)

| Herramienta | Endpoint | Descripción |
|-------------|----------|-------------|
| `list_downloads` | `GET /repositories/{workspace}/{repo}/downloads` | Ver artifacts |
| `upload_download` | `POST /repositories/{workspace}/{repo}/downloads` | Subir artifact |
| `delete_download` | `DELETE /repositories/{workspace}/{repo}/downloads/{filename}` | Eliminar artifact |

---

### 3.3 Issue Tracker

- `list_issues`, `create_issue`, `update_issue`, `get_issue`
- Útil para equipos que no usan Jira

### 3.4 Reports (Code Insights)

- Ver reportes de cobertura y análisis estático
- Integración con herramientas de calidad

---

## Historial de Releases

### v0.3.0 (2025-12-06)
- +16 nuevas herramientas (54 total)
- Tags: `list_tags`, `create_tag`, `delete_tag`
- Branch Restrictions: `list_branch_restrictions`, `create_branch_restriction`, `delete_branch_restriction`
- Source: `get_file_content`, `list_directory`
- Repository Permissions (users): `list_user_permissions`, `get_user_permission`, `update_user_permission`, `delete_user_permission`
- Repository Permissions (groups): `list_group_permissions`, `get_group_permission`, `update_group_permission`, `delete_group_permission`

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

| Métrica | v0.1.x | v0.2.0 | v0.3.0 | v0.4.0 (objetivo) |
|---------|--------|--------|--------|-------------------|
| Herramientas | 18 | 38 | 54 | ~65 |
| Cobertura API | 40% | 70% | 85% | 95% |

---

## Referencias

- [Bitbucket Cloud REST API](https://developer.atlassian.com/cloud/bitbucket/rest/)
- [API Webhooks](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-webhooks/)
- [API Deployments](https://support.atlassian.com/bitbucket-cloud/docs/set-up-and-monitor-bitbucket-deployments/)
- [API Commit Statuses](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-commit-statuses/)
- [API Branch Restrictions](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-branch-restrictions/)
- [API Repository Permissions](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-repositories/#api-repositories-workspace-repo-slug-permissions-config-users-get)
