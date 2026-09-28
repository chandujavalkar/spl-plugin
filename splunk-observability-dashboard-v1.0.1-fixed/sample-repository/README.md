# Sample payment-service

Spring-style REST API + Kafka + Oracle/JDBC + Micrometer + application logging.
Endpoints: POST /payments, GET /payments/{id}, POST /payments/{id}/cancel.
Business logs: payment received/completed/authorization failed/retry. Messaging topics: payment.created, payment.completed, payment.failed.
