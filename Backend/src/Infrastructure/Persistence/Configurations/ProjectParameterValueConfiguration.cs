using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using QaStudio.Core.Automation;
using QaStudio.Core.MasterData;

namespace QaStudio.Infrastructure.Persistence;

/// <summary>Maps <see cref="ProjectParameterValue"/>.</summary>
internal sealed class ProjectParameterValueConfiguration : IEntityTypeConfiguration<ProjectParameterValue>
{
    public void Configure(EntityTypeBuilder<ProjectParameterValue> builder)
    {
        builder.ToTable("ProjectParameterValues");
        builder.HasKey(v => new { v.ProjectId, v.Name });
        builder.Property(v => v.Name).HasMaxLength(ParameterLimits.NameMaxLength).UseCollation(SqlConventions.ExactMatch);
        builder.Property(v => v.Value).HasMaxLength(ParameterLimits.ValueMaxLength).IsRequired();
        builder.Property(v => v.UpdatedAtUtc).HasPrecision(3);
        // Common values go with their project.
        builder.HasOne<Project>().WithMany().HasForeignKey(v => v.ProjectId).OnDelete(DeleteBehavior.Cascade);
    }
}
