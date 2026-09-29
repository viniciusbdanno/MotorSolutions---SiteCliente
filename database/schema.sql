-- Esquema de leituras do motor conforme o contrato definido em instructions.txt.
CREATE DATABASE IF NOT EXISTS motor_solutions CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE motor_solutions;

CREATE TABLE IF NOT EXISTS clientes (
  id_cliente INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(120) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  telefone VARCHAR(30) NOT NULL,
  empresa VARCHAR(120) NOT NULL,
  cargo VARCHAR(100) NOT NULL,
  password_hash VARCHAR(255) NULL,
  email_alerts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS motors (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  motor_id VARCHAR(80) NOT NULL UNIQUE,
  empresa VARCHAR(120) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS readings (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  motor_id INT NOT NULL,
  `timestamp` DATETIME NOT NULL,
  rpm DOUBLE NOT NULL,
  vibration_g DOUBLE NOT NULL,
  temperature_c DOUBLE NOT NULL,
  source_event_id VARCHAR(100) NULL,
  received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  raw_payload JSON NOT NULL,
  CONSTRAINT fk_reading_motor FOREIGN KEY (motor_id) REFERENCES motors(id) ON DELETE CASCADE,
  CONSTRAINT uq_reading_source UNIQUE (motor_id, source_event_id),
  INDEX ix_reading_motor_timestamp (motor_id, `timestamp`),
  INDEX ix_reading_timestamp (`timestamp`)
) ENGINE=InnoDB;
