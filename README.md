# Smart-OM

A professional infrastructure operations management platform combining drone imaging, 3D modeling, and facility documentation.

## 📁 Project Structure

```
smart-om/
├── backend/                 # Node.js/Express API server
│   ├── src/
│   │   ├── routes/         # API endpoints
│   │   ├── services/       # Business logic
│   │   ├── middleware/     # Express middleware
│   │   ├── lib/           # Utilities & helpers
│   │   └── types.ts       # TypeScript type definitions
│   ├── supabase/          # Database migrations & schema
│   ├── package.json
│   ├── Dockerfile
│   └── tsconfig.json
│
├── frontend/               # Next.js web application
│   ├── app/               # Next.js app directory
│   │   ├── [id]/          # Dynamic site routes
│   │   └── demo/          # Demo page
│   ├── features/          # Feature modules
│   │   └── models/        # 3D model viewers
│   ├── utils/             # Utility functions
│   ├── images/            # Static images
│   ├── public/            # Static assets
│   ├── package.json
│   ├── Dockerfile
│   └── tsconfig.json
│
├── assets/                 # Shared project assets
│   └── models/            # 3D model data
│       └── AutotorinoDEF.SOG.sog/  # Sample Gaussian Splatting model
│
└── README.md             # This file
```

## 🚀 Quick Start

### Backend
```bash
cd backend
npm install
npm run dev
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

## 🔧 Technologies

- **Backend**: Node.js, TypeScript, Express, Supabase
- **Frontend**: Next.js 14+, TypeScript, React
- **3D Rendering**: PLY viewers, Gaussian Splat rendering
- **Database**: PostgreSQL (Supabase)

## 📋 Features

- Multi-site facility management
- Drone-based 3D point cloud imaging
- Gaussian Splat and PLY model visualization
- Document and photo management
- Measurement and POI tracking
- Service categorization system

## 🐳 Docker Deployment

Both backend and frontend include Dockerfiles for containerized deployment:

```bash
# Build backend image
docker build -t smart-om-backend ./backend

# Build frontend image  
docker build -t smart-om-frontend ./frontend
```

## 📝 Database

Schema and migrations are located in `backend/supabase/`:
- `schema.sql` - Current database schema
- `migrations/` - Incremental migration files

## 🤝 Contributing

Please ensure TypeScript types and linting pass before submitting PRs.

