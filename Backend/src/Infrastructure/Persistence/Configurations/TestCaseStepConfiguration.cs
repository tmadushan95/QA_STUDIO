using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using QaStudio.Core.TestCases;

namespace QaStudio.Infrastructure.Persistence;

/// <summary>Maps <see cref="TestCaseStep"/>.</summary>
internal sealed class TestCaseStepConfiguration : IEntityTypeConfiguration<TestCaseStep>
{
    public void Configure(EntityTypeBuilder<TestCaseStep> builder)
    {
        builder.ToTable("TestCaseSteps");
        builder.HasKey(s => s.Id);
        builder.Property(s => s.Action).IsRequired();
        // Not unique: a workbook can number two rows alike, and importing must not fail over it.
        builder.HasIndex(s => new { s.TestCaseId, s.StepOrder });
    }
}
