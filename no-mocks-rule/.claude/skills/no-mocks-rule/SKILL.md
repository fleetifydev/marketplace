# Rule: No mocks in integration tests

When writing or modifying tests under `tests/integration/`:
- Do NOT import mocking libraries (unittest.mock, jest.mock, sinon).
- Wire tests to a real, ephemeral test database (testcontainers / docker-compose).
- Mocked integration tests silently mask broken migrations. We don't repeat that.

