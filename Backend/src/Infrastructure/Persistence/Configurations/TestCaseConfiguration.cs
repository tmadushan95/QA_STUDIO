using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using QaStudio.Core.MasterData;
using QaStudio.Core.TestCases;

namespace QaStudio.Infrastructure.Persistence;

/// <summary>Maps <see cref="TestCase"/>.</summary>
internal sealed class TestCaseConfiguration : IEntityTypeConfiguration<TestCase>
{
    public void Configure(EntityTypeBuilder<TestCase> builder)
    {
        builder.ToTable("TestCases", t => t.HasCheckConstraint("CK_TestCases_TagsJson_IsJson", "ISJSON([TagsJson]) = 1 AND ISJSON([DependsOnJson]) = 1"));
        builder.HasKey(c => c.Id);
        builder.Property(c => c.CaseCode).HasMaxLength(TestCase.CodeMaxLength).UseCollation(SqlConventions.ExactMatch).IsRequired();
        builder.Property(c => c.Title).HasMaxLength(TestCase.TitleMaxLength).IsRequired();
        builder.Property(c => c.Module).HasMaxLength(TestCase.LabelMaxLength);
        builder.Property(c => c.Priority).HasMaxLength(TestCase.LabelMaxLength);
        builder.Property(c => c.Severity).HasMaxLength(TestCase.LabelMaxLength);
        builder.Property(c => c.TestType).HasMaxLength(TestCase.LabelMaxLength);
        builder.Property(c => c.UserRole).HasMaxLength(TestCase.LabelMaxLength);
        builder.Property(c => c.Readiness).HasMaxLength(TestCase.ReadinessMaxLength).IsUnicode(false).IsRequired();
        builder.Property(c => c.SourceWorkbook).HasMaxLength(TestCase.LabelMaxLength).IsRequired();
        builder.Property(c => c.SourceWorksheet).HasMaxLength(TestCase.LabelMaxLength).IsRequired();
        builder.Property(c => c.CreatedAtUtc).HasPrecision(3);
        builder.Property(c => c.UpdatedAtUtc).HasPrecision(3);
        builder.Property(c => c.RowVersion).IsRowVersion();
        builder.HasOne(c => c.TestSuite).WithMany().HasForeignKey(c => c.TestSuiteId).OnDelete(DeleteBehavior.Restrict);
        // A version is a label: deleting it clears the label instead of refusing or deleting the cases.
        builder.HasOne<ProjectVersion>().WithMany().HasForeignKey(c => c.ProjectVersionId).OnDelete(DeleteBehavior.SetNull);
        builder.HasMany(c => c.Steps).WithOne().HasForeignKey(s => s.TestCaseId).OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(c => c.Steps).UsePropertyAccessMode(PropertyAccessMode.Field);

        builder.HasIndex(c => c.CaseCode).IsUnique();
        // The list's filter-and-page path: all of a suite's cases in the order they were added.
        builder.HasIndex(c => new { c.TestSuiteId, c.Id });
        builder.HasIndex(c => c.Module).HasFilter("[Module] IS NOT NULL");
        builder.HasIndex(c => c.Priority).HasFilter("[Priority] IS NOT NULL");
        builder.HasIndex(c => c.ProjectVersionId).HasFilter("[ProjectVersionId] IS NOT NULL");
    }
}
