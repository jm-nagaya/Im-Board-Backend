# Im-Board-Backend
Backend API for Im-Board, an anonymous ephemeral image board. Built with Node.js, Express, and PostgreSQL. Handles authentication via Cognito, presigned S3 uploads, daily post limits, and more. It works alongside a React frontend hosted on AWS Amplify. Deployed on AWS Elastic Beanstalk behind CloudFront.

***Note.*** This repo contains the backend for Im-Board. The frontend is in a separate repo: https://github.com/jm-nagaya/Im-Board

## Features
- **Authentication**: Verifies Cognito access tokens and attaches the user to requests.
- **User sync**: Users are synchronized with the Cognito user pool.
- **Presigned uploads**: Generates short-lived S3 URLs so clients can upload directly to S3.
- **Upload validation**: Checks file size, file type, and magic bytes before and after upload.
- **Daily limits**: Enforces one post per user per day.
- **Post management**: Handles image creation, deletion, likes, and flags.
- **Rate limiting**: AWS WAF rate-based rules protect the API at the edge.

## Tech Stack
- Node.js and Express
- PostgreSQL on AWS RDS
- AWS Cognito for authentication
- AWS S3 for file storage
- AWS Lambda for triggers and cleanup jobs
- AWS CloudFront as a proxy
- AWS WAF for rate limiting
- AWS Elastic Beanstalk for deployment

## Getting Started
### Prerequisites
- PostgreSQL (local or RDS)
- AWS account with Cognito, S3, and IAM configured

### Installation
```
git clone https://github.com/jm-nagaya/Im-Board-Backend.git
cd Im-Board-Backend
npm install
```

### Environment Variables
Create a `.env` file in the project root. It should look something like this:
```
# Server
PORT=3001 (or the port you want the API to use)
FRONTEND_URL=your-frontend-url

# Cognito
COGNITO_USER_POOL_ID=your-cognito-user-pool-id
COGNITO_CLIENT_ID=your-client-id

# Database
DB_HOST=your-db-host
DB_PORT=5432 (or the port that your database uses)
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_NAME=postgres (or the db you use)

#S3
AWS_REGION=your-aws-region
S3_BUCKET_NAME=your-s3-bucket-name
AWS_ACCESS_KEY_ID= (optional, for remote access to S3 bucket)
AWS_SECRET_ACCESS_KEY= (optional, for remote access to S3 bucket)

# (IMPORTANT: Make sure this is NOT set in production. Exposes potentially vulnerable endpoint for local testing purposes.)
NODE_ENV=development 
```

## Running Locally
```
npm run dev
```
The API will be available at http://localhost:3001 (or whatever port you have configured).

## API endpoints
| Method |           Endpoint           |              Description              |
| ------ | ---------------------------- | ------------------------------------- |
| POST   | `/api/images/presign-upload` | Request a presigned URL for S3 upload |
| POST   | `/api/images/complete-upload`| Confirm and validate upload           |
| GET    | `/api/images`                | Fetch image data                      |
| GET    | `/api/images/file/:filename` | Serve an image file (development only)|
| DELETE | `/api/images/:id`            | Delete an image                       |
| POST   | `/api/images/:id/like`       | Like an image                         |
| DELETE | `/api/images/:id/like`       | Unlike an image                       |
| POST   | `/api/images/:id/flag`       | Flag an image                         |

## Database Schema
The database uses PostgreSQL. The main tables are:
|          Table        |                                     Purpose                                            |
| --------------------- | -------------------------------------------------------------------------------------- |
| `users`               | Stores user records synced from Cognito. Tracks `last_post` for daily limits.          |
| `images`              | Stores image metadata, file keys, external URLs (for GIFs), and messages.              |
| `likes`               | Tracks which users liked which images. Prevents duplicate likes.                       |
| `flags`               | Tracks flags on images. Prevents duplicate flags.                                      |
| `unconfirmed_uploads` | Tracks uploads that have a presigned URL but have not yet been confirmed.              |

### Relationships
- `images.user_id` references `users.id` with `ON DELETE CASCADE`.
- `likes.user_id` references `users.id` with `ON DELETE CASCADE`.
- `likes.image_id` references `images.id` with `ON DELETE CASCADE`.
- `flags.user_id` references `users.id` with `ON DELETE CASCADE`.
- `flags.image_id` references `images.id` with `ON DELETE CASCADE`.
- `unconfirmed_uploads.user_id` references `users.id` with `ON DELETE CASCADE`.

### Key Constraints
- `users.id` is a unique username.
- `likes` has a composite primary key on `(image_id, user_id)`.
- `flags` has a composite primary key on `(image_id, user_id)`.
- `unconfirmed_uploads` has a unique constraint on `user_id` to prevent multiple pending uploads.

## Security
- All API requests (except `GET /api/images`) are authenticated using Cognito access tokens verified with `aws-jwt-verify`.
- File uploads are validated by size, type, and magic bytes.
- SQL queries use parameterized statements to prevent injection.
- Messages are sanitized using DOMPurify with no allowed HTML tags.
- Rate limiting is enforced at the CloudFront WAF layer.
- Secrets are stored in environment variables and never committed to the repository.

## Frontend
The frontend is built using React and TypeScript. It can be found in the following repo: https://github.com/jm-nagaya/Im-Board

## Contributing
This is a personal project, but suggestions and bug reports are welcome. Feel free to open an issue or submit a pull request.

## License
MIT
