# Citizen Service - Mobile First

HTML + CSS + Vanilla JS + Node.js/Express.

## Current functionality
- Mobile-first Arabic RTL UI.
- New request form.
- Requests are saved in `data/requests.json`.
- Automatic request number: `REQ-YYYY-000001`.
- Default status: `جديد`.
- Request tracking page.
- `/health` endpoint.

## Run
```bash
npm install
npm start
```

Open: http://localhost:3000

## Important
JSON storage is intentionally simple for the first version. For a production multi-user system, move storage to a real database and add authentication, backups, validation, rate limiting, and secure file uploads.
"# mousaservices" 
