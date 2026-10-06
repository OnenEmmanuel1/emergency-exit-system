-- Apply once to databases created with the original Sent/Failed alert enum.
ALTER TABLE alerts
  MODIFY COLUMN status ENUM('Sent', 'Failed', 'Simulated') NOT NULL;
