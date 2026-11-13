using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using QaStudio.Core.Automation;
using QaStudio.Core.TestCases;

namespace QaStudio.Infrastructure.Persistence;

/// <summary>Maps <see cref="ScenarioRevision"/>.</summary>
internal sealed class ScenarioRevisionConfiguration : IEntityTypeConfiguration<ScenarioRevision>
{
    public void Configure(EntityTypeBuilder<ScenarioRevision> builder)
    {
        SqlConventions.RequireJson(builder, "ScenarioRevisions");
        builder.HasKey(s => new { s.CaseCode, s.Version });
        builder.Property(s => s.CaseCode).HasMaxLength(TestCase.CodeMaxLength).UseCollation(SqlConventions.ExactMatch);
    }
}
