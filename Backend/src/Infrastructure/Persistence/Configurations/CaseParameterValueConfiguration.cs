using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using QaStudio.Core.Automation;
using QaStudio.Core.TestCases;

namespace QaStudio.Infrastructure.Persistence;

/// <summary>Maps <see cref="CaseParameterValue"/>.</summary>
internal sealed class CaseParameterValueConfiguration : IEntityTypeConfiguration<CaseParameterValue>
{
    public void Configure(EntityTypeBuilder<CaseParameterValue> builder)
    {
        builder.ToTable("CaseParameterValues");
        builder.HasKey(v => new { v.CaseCode, v.Name });
        // Names are case-sensitive (projectCode and ProjectCode are different parameters), like the cases they belong to.
        builder.Property(v => v.CaseCode).HasMaxLength(TestCase.CodeMaxLength).UseCollation(SqlConventions.ExactMatch);
        builder.Property(v => v.Name).HasMaxLength(ParameterLimits.NameMaxLength).UseCollation(SqlConventions.ExactMatch);
        builder.Property(v => v.Value).HasMaxLength(ParameterLimits.ValueMaxLength).IsRequired();
        builder.Property(v => v.UpdatedAtUtc).HasPrecision(3);
    }
}
