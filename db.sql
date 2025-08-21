CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    telegram_id BIGINT UNIQUE NOT NULL,
    balance NUMERIC(10,2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE transactions (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id),
    transaction_id VARCHAR(100) UNIQUE,
    revenue NUMERIC(10,2),
    currency_amount NUMERIC(10,2),
    provider VARCHAR(50),
    type VARCHAR(20),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE withdrawals (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id),
    amount NUMERIC(10,2),
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT NOW(),
    handled_at TIMESTAMP,
    admin_id BIGINT
);