# joshuasuzuki.com

Personal website built with vanilla HTML, CSS, and JavaScript.

## Architecture
- Static site hosted on S3
- Served via CloudFront
- Custom domain: joshuasuzuki.com
- Backend APIs via AWS API Gateway + Lambdas (contact form + admin)
- RosterLab private ESPN imports via a stateless API Gateway + Lambda relay

## Projects
- `/fantasy/`: RosterLab fantasy baseball trade analysis
- `/sunset/`: Afterglow sunset quality forecast
