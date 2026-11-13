using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using QaStudio.Core.Automation;

namespace QaStudio.Infrastructure.Persistence;

/// <summary>Maps <see cref="AiProviderKey"/>.</summary>
internal sealed class AiProviderKeyConfiguration : IEntityTypeConfiguration<AiProviderKey>
{
    public void Configure(EntityTypeBuilder<AiProviderKey> builder)
    {
        builder.ToTable("AiProviderKeys");
        builder.HasKey(k => k.Provider);
        builder.Property(k => k.Provider).HasMaxLength(DocumentLimits.NameMaxLength);
        builder.Property(k => k.KeyEnc).IsRequired();
        builder.Property(k => k.UpdatedAt).HasMaxLength(DocumentLimits.TimestampMaxLength).IsUnicode(false);
    }
}
