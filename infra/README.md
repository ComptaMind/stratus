# Infra — Local Development

## Services

| Service    | Port(s)       | Purpose                        |
|------------|---------------|--------------------------------|
| PostgreSQL | 5432          | Primary database               |
| Qdrant     | 6333, 6334    | Vector database for embeddings |
| Mailhog    | 1025, 8025    | Local SMTP + email web UI      |

## Start

```bash
docker compose up -d
```

## Stop

```bash
docker compose down
```

## Reset (wipe all data)

```bash
docker compose down -v
```

## Access

- **Mailhog UI**: http://localhost:8025
- **Qdrant dashboard**: http://localhost:6333/dashboard
- **Postgres**: `psql -h localhost -U stratus -d stratus`
