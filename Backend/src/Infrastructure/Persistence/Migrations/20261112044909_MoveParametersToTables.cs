using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace QaStudio.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class MoveParametersToTables : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CaseParameterValues",
                columns: table => new
                {
                    CaseCode = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false, collation: "Latin1_General_100_BIN2"),
                    Name = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false, collation: "Latin1_General_100_BIN2"),
                    Value = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime2(3)", precision: 3, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CaseParameterValues", x => new { x.CaseCode, x.Name });
                });

            migrationBuilder.CreateTable(
                name: "ProjectParameterValues",
                columns: table => new
                {
                    ProjectId = table.Column<int>(type: "int", nullable: false),
                    Name = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false, collation: "Latin1_General_100_BIN2"),
                    Value = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime2(3)", precision: 3, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProjectParameterValues", x => new { x.ProjectId, x.Name });
                    table.ForeignKey(
                        name: "FK_ProjectParameterValues_Projects_ProjectId",
                        column: x => x.ProjectId,
                        principalTable: "Projects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            // Copy the values out of the two config blocks they were kept in. The blocks are left in place, so nothing is lost
            // if the upgrade has to be backed out. Only values the new tables would accept are copied; the rest could never
            // have been saved through the app (empty, over 500 characters, a name that breaks the rule) or belong to a case
            // or project that no longer exists. The copy is safe to run twice.
            migrationBuilder.Sql(CopyCaseValues);
            migrationBuilder.Sql(CopyProjectValues);
        }

        /// <summary>
        /// Copies <c>case-parameters</c> (<c>{ "case id": { "name": "value" } }</c>). OPENJSON is fed an empty object whenever a level
        /// is not an object, because SQL Server may evaluate it before the filters that would skip such a row.
        /// </summary>
        public const string CopyCaseValues = """
            INSERT INTO dbo.CaseParameterValues (CaseCode, Name, Value, UpdatedAtUtc)
            SELECT o.[key] COLLATE Latin1_General_100_BIN2, v.[key] COLLATE Latin1_General_100_BIN2, LTRIM(RTRIM(v.[value])), SYSUTCDATETIME()
            FROM dbo.ConfigEntries c
            CROSS APPLY OPENJSON(CASE WHEN ISJSON(c.Json) = 1 THEN c.Json ELSE N'{}' END) o
            CROSS APPLY OPENJSON(CASE WHEN o.[type] = 5 THEN o.[value] ELSE N'{}' END) v
            WHERE c.[Key] = N'case-parameters'
              AND v.[type] = 1
              AND LEN(o.[key]) BETWEEN 1 AND 200
              AND LEN(v.[key]) BETWEEN 1 AND 100
              AND LEFT(v.[key], 1) COLLATE Latin1_General_100_BIN2 LIKE N'[A-Za-z]'
              AND v.[key] COLLATE Latin1_General_100_BIN2 NOT LIKE N'%[^-A-Za-z0-9_]%'
              AND LEN(LTRIM(RTRIM(v.[value]))) BETWEEN 1 AND 500
              AND EXISTS (SELECT 1 FROM dbo.TestCases t WHERE t.CaseCode = o.[key] COLLATE Latin1_General_100_BIN2)
              AND NOT EXISTS (
                  SELECT 1 FROM dbo.CaseParameterValues x
                  WHERE x.CaseCode = o.[key] COLLATE Latin1_General_100_BIN2 AND x.Name = v.[key] COLLATE Latin1_General_100_BIN2);
            """;

        /// <summary>Copies <c>project-parameters</c> (<c>{ "project id": { "name": "value" } }</c>).</summary>
        public const string CopyProjectValues = """
            INSERT INTO dbo.ProjectParameterValues (ProjectId, Name, Value, UpdatedAtUtc)
            SELECT TRY_CAST(o.[key] AS int), v.[key] COLLATE Latin1_General_100_BIN2, LTRIM(RTRIM(v.[value])), SYSUTCDATETIME()
            FROM dbo.ConfigEntries c
            CROSS APPLY OPENJSON(CASE WHEN ISJSON(c.Json) = 1 THEN c.Json ELSE N'{}' END) o
            CROSS APPLY OPENJSON(CASE WHEN o.[type] = 5 THEN o.[value] ELSE N'{}' END) v
            WHERE c.[Key] = N'project-parameters'
              AND v.[type] = 1
              AND EXISTS (SELECT 1 FROM dbo.Projects p WHERE p.Id = TRY_CAST(o.[key] AS int))
              AND LEN(v.[key]) BETWEEN 1 AND 100
              AND LEFT(v.[key], 1) COLLATE Latin1_General_100_BIN2 LIKE N'[A-Za-z]'
              AND v.[key] COLLATE Latin1_General_100_BIN2 NOT LIKE N'%[^-A-Za-z0-9_]%'
              AND LEN(LTRIM(RTRIM(v.[value]))) BETWEEN 1 AND 500
              AND NOT EXISTS (
                  SELECT 1 FROM dbo.ProjectParameterValues x
                  WHERE x.ProjectId = TRY_CAST(o.[key] AS int) AND x.Name = v.[key] COLLATE Latin1_General_100_BIN2);
            """;

        /// <summary>Backing out writes the two blocks again from the tables, so values saved after the upgrade are not lost.</summary>
        public const string RebuildBlocks = """
            DECLARE @cases nvarchar(max) = N'{}', @projects nvarchar(max) = N'{}';

            WITH perCase AS (
                SELECT CaseCode, N'{' + STRING_AGG(CAST(N'"' + STRING_ESCAPE(Name COLLATE DATABASE_DEFAULT, 'json') + N'":"' + STRING_ESCAPE(Value COLLATE DATABASE_DEFAULT, 'json') + N'"' AS nvarchar(max)), N',') + N'}' AS Obj
                FROM dbo.CaseParameterValues GROUP BY CaseCode)
            SELECT @cases = N'{' + STRING_AGG(CAST(N'"' + STRING_ESCAPE(CaseCode COLLATE DATABASE_DEFAULT, 'json') + N'":' + Obj AS nvarchar(max)), N',') + N'}' FROM perCase;

            WITH perProject AS (
                SELECT ProjectId, N'{' + STRING_AGG(CAST(N'"' + STRING_ESCAPE(Name COLLATE DATABASE_DEFAULT, 'json') + N'":"' + STRING_ESCAPE(Value COLLATE DATABASE_DEFAULT, 'json') + N'"' AS nvarchar(max)), N',') + N'}' AS Obj
                FROM dbo.ProjectParameterValues GROUP BY ProjectId)
            SELECT @projects = N'{' + STRING_AGG(CAST(N'"' + CAST(ProjectId AS nvarchar(20)) + N'":' + Obj AS nvarchar(max)), N',') + N'}' FROM perProject;

            IF EXISTS (SELECT 1 FROM dbo.ConfigEntries WHERE [Key] = N'case-parameters') UPDATE dbo.ConfigEntries SET Json = ISNULL(@cases, N'{}') WHERE [Key] = N'case-parameters';
            ELSE INSERT INTO dbo.ConfigEntries ([Key], Json) VALUES (N'case-parameters', ISNULL(@cases, N'{}'));
            IF EXISTS (SELECT 1 FROM dbo.ConfigEntries WHERE [Key] = N'project-parameters') UPDATE dbo.ConfigEntries SET Json = ISNULL(@projects, N'{}') WHERE [Key] = N'project-parameters';
            ELSE INSERT INTO dbo.ConfigEntries ([Key], Json) VALUES (N'project-parameters', ISNULL(@projects, N'{}'));
            """;

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(RebuildBlocks);

            migrationBuilder.DropTable(
                name: "CaseParameterValues");

            migrationBuilder.DropTable(
                name: "ProjectParameterValues");
        }
    }
}
