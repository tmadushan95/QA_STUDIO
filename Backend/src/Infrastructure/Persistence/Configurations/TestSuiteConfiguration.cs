using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using QaStudio.Core.MasterData;

namespace QaStudio.Infrastructure.Persistence;

/// <summary>Maps <see cref="TestSuite"/>.</summary>
internal sealed class TestSuiteConfiguration : IEntityTypeConfiguration<TestSuite>
{
    public void Configure(EntityTypeBuilder<TestSuite> builder)
    {
        builder.ToTable("TestSuites");
        builder.HasKey(s => s.Id);
        builder.Property(s => s.Name).HasMaxLength(TestSuite.NameMaxLength).IsRequired();
        builder.Property(s => s.Description).HasMaxLength(TestSuite.DescriptionMaxLength);
        builder.Property(s => s.CreatedAtUtc).HasPrecision(3);
        builder.Property(s => s.UpdatedAtUtc).HasPrecision(3);
        builder.Property(s => s.RowVersion).IsRowVersion();
        // Restrict: deleting a project must never silently take its suites and test cases with it.
        builder.HasOne(s => s.Project).WithMany(p => p.Suites).HasForeignKey(s => s.ProjectId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(s => new { s.ProjectId, s.Name }).IsUnique();
        builder.HasData(new
        {
            Id = 1,
            ProjectId = 1,
            Name = TestSuite.UnassignedName,
            Description = TestSuite.UnassignedDescription,
            SortOrder = 0,
            IsActive = true,
            CreatedAtUtc = SqlConventions.SeedTime,
            UpdatedAtUtc = SqlConventions.SeedTime,
        });
    }
}
