using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using QaStudio.Core.Automation;

namespace QaStudio.Infrastructure.Persistence;

/// <summary>Maps <see cref="DataBackup"/>.</summary>
internal sealed class DataBackupConfiguration : IEntityTypeConfiguration<DataBackup>
{
    public void Configure(EntityTypeBuilder<DataBackup> builder)
    {
        SqlConventions.RequireJson(builder, "DataBackups");
        builder.HasKey(b => b.Id);
        builder.Property(b => b.Id).HasMaxLength(DocumentLimits.IdMaxLength).IsUnicode(false);
        builder.Property(b => b.CreatedAtUtc).HasPrecision(3);
        builder.Property(b => b.Reason).HasMaxLength(DocumentLimits.ReasonMaxLength).IsRequired();
    }
}
