using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using QaStudio.Core.Automation;
using QaStudio.Core.TestCases;

namespace QaStudio.Infrastructure.Persistence;

/// <summary>Maps <see cref="ScenarioRecord"/>.</summary>
internal sealed class ScenarioRecordConfiguration : IEntityTypeConfiguration<ScenarioRecord>
{
    public void Configure(EntityTypeBuilder<ScenarioRecord> builder)
    {
        SqlConventions.RequireJson(builder, "ScenarioRecords");
        builder.HasKey(s => new { s.CaseCode, s.Slot });
        builder.Property(s => s.CaseCode).HasMaxLength(TestCase.CodeMaxLength).UseCollation(SqlConventions.ExactMatch);
        builder.Property(s => s.Slot).HasConversion<byte>();
        builder.Property(s => s.Status).HasMaxLength(DocumentLimits.StatusMaxLength).IsUnicode(false);
    }
}
