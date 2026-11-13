using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using QaStudio.Core.Automation;

namespace QaStudio.Infrastructure.Persistence;

/// <summary>Maps <see cref="TestAccount"/>.</summary>
internal sealed class TestAccountConfiguration : IEntityTypeConfiguration<TestAccount>
{
    public void Configure(EntityTypeBuilder<TestAccount> builder)
    {
        builder.ToTable("TestAccounts");
        builder.HasKey(a => a.Id);
        builder.Property(a => a.Id).HasMaxLength(DocumentLimits.IdMaxLength);
        builder.Property(a => a.Label).HasMaxLength(DocumentLimits.LabelMaxLength).IsRequired();
        builder.Property(a => a.Username).HasMaxLength(DocumentLimits.UsernameMaxLength).IsRequired();
        builder.Property(a => a.PasswordEnc).IsRequired();
        builder.Property(a => a.CreatedAt).HasMaxLength(DocumentLimits.TimestampMaxLength).IsUnicode(false);
        builder.Property(a => a.UpdatedAt).HasMaxLength(DocumentLimits.TimestampMaxLength).IsUnicode(false);
        // No foreign key: rows are written by the worker's queue, where a refused write would be dropped with its batch.
        // Deleting a project is what checks for accounts (see DeleteProjectHandler).
        builder.HasIndex(a => new { a.ProjectId, a.Label }).IsUnique();
    }
}
