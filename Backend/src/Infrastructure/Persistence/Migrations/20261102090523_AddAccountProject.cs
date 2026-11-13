using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace QaStudio.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAccountProject : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_TestAccounts_Label",
                table: "TestAccounts");

            migrationBuilder.AddColumn<int>(
                name: "ProjectId",
                table: "TestAccounts",
                type: "int",
                nullable: false,
                defaultValue: 0);

            // Accounts used to serve every project. They go to the project holding the most test cases, the one they
            // have been signing in for; with no cases anywhere, to the default project.
            migrationBuilder.Sql(
                """
                UPDATE TestAccounts SET ProjectId = COALESCE(
                    (SELECT TOP 1 s.ProjectId FROM TestSuites s JOIN TestCases c ON c.TestSuiteId = s.Id
                     GROUP BY s.ProjectId ORDER BY COUNT(*) DESC, s.ProjectId),
                    (SELECT MIN(Id) FROM Projects), 0);
                """);

            migrationBuilder.CreateIndex(
                name: "IX_TestAccounts_ProjectId_Label",
                table: "TestAccounts",
                columns: new[] { "ProjectId", "Label" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_TestAccounts_ProjectId_Label",
                table: "TestAccounts");

            migrationBuilder.DropColumn(
                name: "ProjectId",
                table: "TestAccounts");

            migrationBuilder.CreateIndex(
                name: "IX_TestAccounts_Label",
                table: "TestAccounts",
                column: "Label",
                unique: true);
        }
    }
}
