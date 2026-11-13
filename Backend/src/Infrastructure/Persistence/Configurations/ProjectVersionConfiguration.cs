using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using QaStudio.Core.MasterData;

namespace QaStudio.Infrastructure.Persistence;

/// <summary>Maps <see cref="ProjectVersion"/>.</summary>
internal sealed class ProjectVersionConfiguration : IEntityTypeConfiguration<ProjectVersion>
{
    public void Configure(EntityTypeBuilder<ProjectVersion> builder)
    {
        builder.ToTable("ProjectVersions");
        builder.HasKey(v => v.Id);
        builder.Property(v => v.Name).HasMaxLength(ProjectVersion.NameMaxLength).IsRequired();
        builder.Property(v => v.Description).HasMaxLength(ProjectVersion.DescriptionMaxLength);
        builder.Property(v => v.ReleaseDate).HasColumnType("date");
        builder.Property(v => v.CreatedAtUtc).HasPrecision(3);
        builder.Property(v => v.UpdatedAtUtc).HasPrecision(3);
        builder.Property(v => v.RowVersion).IsRowVersion();
        // Cascade is safe here: a project can only be deleted once it has no suites, so no case can still carry one of
        // its versions; and a version is only a label, never the owner of test cases.
        builder.HasOne(v => v.Project).WithMany().HasForeignKey(v => v.ProjectId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(v => new { v.ProjectId, v.Name }).IsUnique();
    }
}
