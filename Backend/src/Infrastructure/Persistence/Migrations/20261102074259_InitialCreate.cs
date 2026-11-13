using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace QaStudio.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "AiProviderKeys",
                columns: table => new
                {
                    Provider = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    KeyEnc = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    UpdatedAt = table.Column<string>(type: "varchar(40)", unicode: false, maxLength: 40, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AiProviderKeys", x => x.Provider);
                });

            migrationBuilder.CreateTable(
                name: "AuditLog",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    AtUtc = table.Column<DateTime>(type: "datetime2(3)", precision: 3, nullable: false),
                    Action = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    Target = table.Column<string>(type: "nvarchar(400)", maxLength: 400, nullable: false),
                    Detail = table.Column<string>(type: "nvarchar(max)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AuditLog", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ConfigEntries",
                columns: table => new
                {
                    Key = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    Json = table.Column<string>(type: "nvarchar(max)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ConfigEntries", x => x.Key);
                });

            migrationBuilder.CreateTable(
                name: "DataBackups",
                columns: table => new
                {
                    Id = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime2(3)", precision: 3, nullable: false),
                    Reason = table.Column<string>(type: "nvarchar(400)", maxLength: 400, nullable: false),
                    Json = table.Column<string>(type: "nvarchar(max)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DataBackups", x => x.Id);
                    table.CheckConstraint("CK_DataBackups_Json_IsJson", "ISJSON([Json]) = 1");
                });

            migrationBuilder.CreateTable(
                name: "Projects",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Code = table.Column<string>(type: "nvarchar(30)", maxLength: 30, nullable: false),
                    Name = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    Description = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: true),
                    IsActive = table.Column<bool>(type: "bit", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime2(3)", precision: 3, nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime2(3)", precision: 3, nullable: false),
                    RowVersion = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Projects", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ScenarioRecords",
                columns: table => new
                {
                    CaseCode = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false, collation: "Latin1_General_100_BIN2"),
                    Slot = table.Column<byte>(type: "tinyint", nullable: false),
                    Version = table.Column<int>(type: "int", nullable: false),
                    Status = table.Column<string>(type: "varchar(20)", unicode: false, maxLength: 20, nullable: false),
                    Json = table.Column<string>(type: "nvarchar(max)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ScenarioRecords", x => new { x.CaseCode, x.Slot });
                    table.CheckConstraint("CK_ScenarioRecords_Json_IsJson", "ISJSON([Json]) = 1");
                });

            migrationBuilder.CreateTable(
                name: "ScenarioRevisions",
                columns: table => new
                {
                    CaseCode = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false, collation: "Latin1_General_100_BIN2"),
                    Version = table.Column<int>(type: "int", nullable: false),
                    Json = table.Column<string>(type: "nvarchar(max)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ScenarioRevisions", x => new { x.CaseCode, x.Version });
                    table.CheckConstraint("CK_ScenarioRevisions_Json_IsJson", "ISJSON([Json]) = 1");
                });

            migrationBuilder.CreateTable(
                name: "TestAccounts",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    Label = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    Username = table.Column<string>(type: "nvarchar(320)", maxLength: 320, nullable: false),
                    PasswordEnc = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    CreatedAt = table.Column<string>(type: "varchar(40)", unicode: false, maxLength: 40, nullable: false),
                    UpdatedAt = table.Column<string>(type: "varchar(40)", unicode: false, maxLength: 40, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TestAccounts", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "TestDataValues",
                columns: table => new
                {
                    Key = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false, collation: "Latin1_General_100_BIN2"),
                    Json = table.Column<string>(type: "nvarchar(max)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TestDataValues", x => x.Key);
                });

            migrationBuilder.CreateTable(
                name: "TestRuns",
                columns: table => new
                {
                    Id = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime2(3)", precision: 3, nullable: false),
                    Status = table.Column<string>(type: "varchar(20)", unicode: false, maxLength: 20, nullable: false),
                    Json = table.Column<string>(type: "nvarchar(max)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TestRuns", x => x.Id);
                    table.CheckConstraint("CK_TestRuns_Json_IsJson", "ISJSON([Json]) = 1");
                });

            migrationBuilder.CreateTable(
                name: "TestSuites",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ProjectId = table.Column<int>(type: "int", nullable: false),
                    Name = table.Column<string>(type: "nvarchar(400)", maxLength: 400, nullable: false),
                    Description = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: true),
                    SortOrder = table.Column<int>(type: "int", nullable: false),
                    IsActive = table.Column<bool>(type: "bit", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime2(3)", precision: 3, nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime2(3)", precision: 3, nullable: false),
                    RowVersion = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TestSuites", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TestSuites_Projects_ProjectId",
                        column: x => x.ProjectId,
                        principalTable: "Projects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "AccountSessions",
                columns: table => new
                {
                    AccountId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    StateEnc = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    SavedAt = table.Column<string>(type: "varchar(40)", unicode: false, maxLength: 40, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AccountSessions", x => x.AccountId);
                    table.ForeignKey(
                        name: "FK_AccountSessions_TestAccounts_AccountId",
                        column: x => x.AccountId,
                        principalTable: "TestAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "TestCases",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CaseCode = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false, collation: "Latin1_General_100_BIN2"),
                    TestSuiteId = table.Column<int>(type: "int", nullable: false),
                    Title = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    Description = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Module = table.Column<string>(type: "nvarchar(400)", maxLength: 400, nullable: true),
                    Preconditions = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    ExpectedResult = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Priority = table.Column<string>(type: "nvarchar(400)", maxLength: 400, nullable: true),
                    Severity = table.Column<string>(type: "nvarchar(400)", maxLength: 400, nullable: true),
                    TestType = table.Column<string>(type: "nvarchar(400)", maxLength: 400, nullable: true),
                    UserRole = table.Column<string>(type: "nvarchar(400)", maxLength: 400, nullable: true),
                    TagsJson = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    DependsOnJson = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Readiness = table.Column<string>(type: "varchar(40)", unicode: false, maxLength: 40, nullable: false),
                    SourceWorkbook = table.Column<string>(type: "nvarchar(400)", maxLength: 400, nullable: false),
                    SourceWorksheet = table.Column<string>(type: "nvarchar(400)", maxLength: 400, nullable: false),
                    SourceRowNumber = table.Column<int>(type: "int", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime2(3)", precision: 3, nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime2(3)", precision: 3, nullable: false),
                    RowVersion = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TestCases", x => x.Id);
                    table.CheckConstraint("CK_TestCases_TagsJson_IsJson", "ISJSON([TagsJson]) = 1 AND ISJSON([DependsOnJson]) = 1");
                    table.ForeignKey(
                        name: "FK_TestCases_TestSuites_TestSuiteId",
                        column: x => x.TestSuiteId,
                        principalTable: "TestSuites",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "TestCaseSteps",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    TestCaseId = table.Column<long>(type: "bigint", nullable: false),
                    StepOrder = table.Column<int>(type: "int", nullable: false),
                    Action = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Expected = table.Column<string>(type: "nvarchar(max)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TestCaseSteps", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TestCaseSteps_TestCases_TestCaseId",
                        column: x => x.TestCaseId,
                        principalTable: "TestCases",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.InsertData(
                table: "Projects",
                columns: new[] { "Id", "Code", "CreatedAtUtc", "Description", "IsActive", "Name", "UpdatedAtUtc" },
                values: new object[] { 1, "GENERAL", new DateTime(2026, 11, 2, 0, 0, 0, 0, DateTimeKind.Utc), "Test cases not yet filed under a project.", true, "General", new DateTime(2026, 11, 2, 0, 0, 0, 0, DateTimeKind.Utc) });

            migrationBuilder.InsertData(
                table: "TestSuites",
                columns: new[] { "Id", "CreatedAtUtc", "Description", "IsActive", "Name", "ProjectId", "SortOrder", "UpdatedAtUtc" },
                values: new object[] { 1, new DateTime(2026, 11, 2, 0, 0, 0, 0, DateTimeKind.Utc), "Test cases that arrived without a module.", true, "Unassigned", 1, 0, new DateTime(2026, 11, 2, 0, 0, 0, 0, DateTimeKind.Utc) });

            migrationBuilder.CreateIndex(
                name: "IX_Projects_Code",
                table: "Projects",
                column: "Code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_TestAccounts_Label",
                table: "TestAccounts",
                column: "Label",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_TestCases_CaseCode",
                table: "TestCases",
                column: "CaseCode",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_TestCases_Module",
                table: "TestCases",
                column: "Module",
                filter: "[Module] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_TestCases_Priority",
                table: "TestCases",
                column: "Priority",
                filter: "[Priority] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_TestCases_TestSuiteId_Id",
                table: "TestCases",
                columns: new[] { "TestSuiteId", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_TestCaseSteps_TestCaseId_StepOrder",
                table: "TestCaseSteps",
                columns: new[] { "TestCaseId", "StepOrder" });

            migrationBuilder.CreateIndex(
                name: "IX_TestRuns_CreatedAtUtc",
                table: "TestRuns",
                column: "CreatedAtUtc",
                descending: new bool[0]);

            migrationBuilder.CreateIndex(
                name: "IX_TestSuites_ProjectId_Name",
                table: "TestSuites",
                columns: new[] { "ProjectId", "Name" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AccountSessions");

            migrationBuilder.DropTable(
                name: "AiProviderKeys");

            migrationBuilder.DropTable(
                name: "AuditLog");

            migrationBuilder.DropTable(
                name: "ConfigEntries");

            migrationBuilder.DropTable(
                name: "DataBackups");

            migrationBuilder.DropTable(
                name: "ScenarioRecords");

            migrationBuilder.DropTable(
                name: "ScenarioRevisions");

            migrationBuilder.DropTable(
                name: "TestCaseSteps");

            migrationBuilder.DropTable(
                name: "TestDataValues");

            migrationBuilder.DropTable(
                name: "TestRuns");

            migrationBuilder.DropTable(
                name: "TestAccounts");

            migrationBuilder.DropTable(
                name: "TestCases");

            migrationBuilder.DropTable(
                name: "TestSuites");

            migrationBuilder.DropTable(
                name: "Projects");
        }
    }
}
