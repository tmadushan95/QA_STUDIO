using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using QaStudio.Core.Automation;

namespace QaStudio.Infrastructure.Persistence;

/// <summary>Maps <see cref="TestRun"/>.</summary>
internal sealed class TestRunConfiguration : IEntityTypeConfiguration<TestRun>
{
    public void Configure(EntityTypeBuilder<TestRun> builder)
    {
        SqlConventions.RequireJson(builder, "TestRuns");
        builder.HasKey(r => r.Id);
        builder.Property(r => r.Id).HasMaxLength(DocumentLimits.IdMaxLength).IsUnicode(false);
        builder.Property(r => r.CreatedAtUtc).HasPrecision(3);
        builder.Property(r => r.Status).HasMaxLength(DocumentLimits.StatusMaxLength).IsUnicode(false);
        builder.HasIndex(r => r.CreatedAtUtc).IsDescending();
    }
}
