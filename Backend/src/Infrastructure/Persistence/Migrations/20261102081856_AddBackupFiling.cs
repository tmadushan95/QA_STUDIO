using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace QaStudio.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddBackupFiling : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "FilingJson",
                table: "DataBackups",
                type: "nvarchar(max)",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "FilingJson",
                table: "DataBackups");
        }
    }
}
