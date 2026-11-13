using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using QaStudio.Core.Automation;

namespace QaStudio.Infrastructure.Persistence;

/// <summary>Maps <see cref="AccountSession"/>.</summary>
internal sealed class AccountSessionConfiguration : IEntityTypeConfiguration<AccountSession>
{
    public void Configure(EntityTypeBuilder<AccountSession> builder)
    {
        builder.ToTable("AccountSessions");
        builder.HasKey(s => s.AccountId);
        builder.Property(s => s.AccountId).HasMaxLength(DocumentLimits.IdMaxLength);
        builder.Property(s => s.StateEnc).IsRequired();
        builder.Property(s => s.SavedAt).HasMaxLength(DocumentLimits.TimestampMaxLength).IsUnicode(false);
        builder.HasOne<TestAccount>().WithOne().HasForeignKey<AccountSession>(s => s.AccountId).OnDelete(DeleteBehavior.Cascade);
    }
}
