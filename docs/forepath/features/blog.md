# Blog (Ghost CMS)

The ForePath marketing site renders the company blog from Ghost at `https://blog.forepath.io` via the public Content API.

## Routes

| Path          | Purpose                                    |
| ------------- | ------------------------------------------ |
| `/blog`       | Browse and search published posts          |
| `/blog/:slug` | SEO-friendly post detail (slug from Ghost) |

Canonical URLs use `https://forepath.io/blog/...` (not the private Ghost frontend).

## Configuration

Set on the ForePath landing environment (`environment.landingpage.ts` / `.production.ts` in `@forepath/forepath/frontend/util-configuration`):

```ts
blog: {
  urls: { contentApi: 'https://blog.forepath.io' },
  contentApiKey: '<Ghost Content API key>',
}
```

Content API keys are read-only and intended for browser use. Other product environments leave `blog` unset.

## Implementation

- Feature UI and Ghost client: `libs/domains/forepath/frontend/feature-landingpage/src/lib/blog/`
- Client library: `@tryghost/content-api`
- Titles follow `Title :: ForePath`; post meta (description, image, tags, author) prefers Ghost SEO fields with sensible fallbacks
- Ghost fetches register with Angular `PendingTasks` so SSR/prerender waits for post data instead of serializing the loading UI (axios does not contribute to stability by itself)
