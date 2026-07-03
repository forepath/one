# Forepath Backend Communication

NestJS API that proxies public contact form submissions to Chatwoot.

## Quick start

```bash
nx serve forepath-backend-communication
```

Health check: `GET http://localhost:3300/api/health`

Contact endpoint: `POST http://localhost:3300/api/public/contact-requests`

See [docs/forepath/applications/backend-communication.md](../../../docs/forepath/applications/backend-communication.md) for environment variables, Docker, and Chatwoot setup.

## License

Source-available, internal use only. See [LICENSE](./LICENSE).
