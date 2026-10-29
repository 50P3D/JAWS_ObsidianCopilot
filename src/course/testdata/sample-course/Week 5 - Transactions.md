# Week 5: Transactions

Sample lecture notes for testing the course index. Not real course material.

## ACID

- Atomicity: a transaction happens completely or not at all.
- Consistency: a transaction moves the database from one valid state to another.
- Isolation: concurrent transactions do not see each other's partial work.
- Durability: once committed, a transaction survives a crash.

## Isolation levels

- The four SQL isolation levels, weakest first, are Read Uncommitted, Read Committed, Repeatable Read and Serializable.
- Read Committed prevents dirty reads but still allows non-repeatable reads.
- Serializable is the only level that prevents phantom reads in every case.
- PostgreSQL uses Read Committed as its default isolation level.

## Two-phase locking (2PL)

- In the growing phase a transaction may acquire locks but not release any.
- In the shrinking phase it may release locks but not acquire any.
- Strict 2PL holds all exclusive locks until the transaction commits or aborts.
