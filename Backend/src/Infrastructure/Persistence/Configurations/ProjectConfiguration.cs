using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using QaStudio.Core.MasterData;

namespace QaStudio.Infrastructure.Persistence;

/// <summary>Maps <see cref="Project"/>.</summary>
internal sealed class ProjectConfiguration : IEntityTypeConfiguration<Project>
{
    public void Configure(EntityTypeBuilder<Project> builder)
    {
        builder.ToTable("Projects");
        builder.HasKey(p => p.Id);
        builder.Property(p => p.Code).HasMaxLength(Project.CodeMaxLength).IsRequired();
        builder.Property(p => p.Name).HasMaxLength(Project.NameMaxLength).IsRequired();
        builder.Property(p => p.Description).HasMaxLength(Project.DescriptionMaxLength);
        builder.Property(p => p.CreatedAtUtc).HasPrecision(3);
        builder.Property(p => p.UpdatedAtUtc).HasPrecision(3);
        builder.Property(p => p.RowVersion).IsRowVersion();
        builder.HasIndex(p => p.Code).IsUnique();
        builder.Navigation(p => p.Suites).UsePropertyAccessMode(PropertyAccessMode.Field);
        // Always one place for imported cases to land, and something to choose on a fresh install.
        builder.HasData(new
        {
            Id = 1,
            Code = Project.DefaultCode,
            Name = Project.DefaultName,
            Description = Project.DefaultDescription,
            IsActive = true,
            CreatedAtUtc = SqlConventions.SeedTime,
            UpdatedAtUtc = SqlConventions.SeedTime,
        });
    }
}
