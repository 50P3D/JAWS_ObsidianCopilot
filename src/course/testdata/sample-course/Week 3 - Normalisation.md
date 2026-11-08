---
tags: [databases, lecture]
---
# Week 3: Normalisation

Sample lecture notes for testing the course index. Not real course material.

## Why normalise

- Normalisation removes redundancy so the same fact is stored once.
- Redundancy causes update, insertion and deletion anomalies.

## First normal form (1NF)

- A relation is in 1NF when every attribute holds a single atomic value.
- Repeating groups, such as a column holding a list of phone numbers, break 1NF.

## Second normal form (2NF)

- A relation is in 2NF when it is in 1NF and has no partial dependencies.
- A partial dependency is a non-key attribute that depends on only part of a composite key.
- A relation with a single-attribute key is automatically in 2NF.

## Third normal form (3NF)

- A relation is in 3NF when it is in 2NF and has no transitive dependencies.
- A transitive dependency is a non-key attribute that depends on another non-key attribute.
- In this course we normalise every schema to 3NF unless told otherwise.

## Boyce-Codd normal form (BCNF)

- BCNF is stricter than 3NF: every determinant must be a candidate key.
- BCNF was defined by Raymond Boyce and Edgar F. Codd in 1974.
