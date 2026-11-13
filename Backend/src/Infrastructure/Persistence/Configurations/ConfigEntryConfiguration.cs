using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using QaStudio.Core.Automation;

namespace QaStudio.Infrastructure.Persistence;

/// <summary>Maps <see cref="ConfigEntry"/>.</summary>
internal sealed class ConfigEntryConfiguration : IEntityTypeConfiguration<ConfigEntry>
{
    public void Configure(EntityTypeBuilder<ConfigEntry> builder)
    {
        builder.ToTable("ConfigEntries");
        builder.HasKey(c => c.Key);
        builder.Property(c => c.Key).HasMaxLength(DocumentLimits.NameMaxLength);
    }
}
