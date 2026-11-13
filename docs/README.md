# Documentation

New here? [GETTING-STARTED.md](GETTING-STARTED.md) covers setup and running. Then read the guide for the side you work on.

| Document                                               | What it covers                                                                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| [ARCHITECTURE-GUIDE.md](ARCHITECTURE-GUIDE.md)         | **Start here if you are new:** the whole system explained simply, with one request followed end to end and every pattern |
| [BACKEND.md](BACKEND.md)                               | End to end: .NET API (CQRS, DDD, patterns), Node worker, runs, data, safety, errors, quality                             |
| [FRONTEND.md](FRONTEND.md)                             | End to end: structure, pages, project setup, talking to the server, design system, quality                               |
| [STEP-FORMAT.md](STEP-FORMAT.md)                       | Every generic step action, how elements are found, parameters and remembered values                                      |
| [TEST-CASES-AND-IMPORTS.md](TEST-CASES-AND-IMPORTS.md) | Test Case Studio, versions, parameters, Excel/AI/Azure DevOps import, clearing and undo                                  |
| [DATABASE.md](DATABASE.md)                             | SQL Server schema, how the API and worker share data, performance, the data migration                                    |
| [AI-AND-MCP.md](AI-AND-MCP.md)                         | AI features, their rules, and connecting an AI assistant through MCP                                                     |
| [adr/](adr/)                                           | Architecture decisions and why they were made                                                                            |
| [CHANGELOG.md](CHANGELOG.md)                           | What changed, release by release                                                                                         |

Setup commands and every setting of the API: [Backend/README.md](../Backend/README.md). The same for the web app:
[Frontend/README.md](../Frontend/README.md).

Rule: a change that alters behaviour updates the matching document in the same commit.
