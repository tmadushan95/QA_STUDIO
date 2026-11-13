using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using QaStudio.Core.Automation;

namespace QaStudio.Infrastructure.Persistence;

/// <summary>Maps <see cref="AuditEntry"/>.</summary>
internal sealed class AuditEntryConfiguration : IEntityTypeConfiguration<AuditEntry>
{
    public void Configure(EntityTypeBuilder<AuditEntry> builder)
    {
        builder.ToTable("AuditLog");
        builder.HasKey(a => a.Id);
        builder.Property(a => a.AtUtc).HasPrecision(3);
        builder.Property(a => a.Action).HasMaxLength(DocumentLimits.NameMaxLength).IsRequired();
        builder.Property(a => a.Target).HasMaxLength(DocumentLimits.ReasonMaxLength).IsRequired();
        builder.Property(a => a.Detail).IsRequired();
    }
}
