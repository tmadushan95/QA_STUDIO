using QaStudio.Core.Common;

namespace QaStudio.Core.Automation;

/// <summary>A test account. The password is only ever held as ciphertext; only the worker has the key.</summary>
public sealed class TestAccount
{
    private TestAccount()
    {
    }

    /// <summary>Account ID.</summary>
    public string Id { get; private set; } = string.Empty;

    /// <summary>The project this account signs in to. Sign-in belongs to a project, so an account belongs to one too.</summary>
    public int ProjectId { get; private set; }

    /// <summary>Label, unique ignoring case within its project.</summary>
    public string Label { get; private set; } = string.Empty;

    /// <summary>Sign-in name.</summary>
    public string Username { get; private set; } = string.Empty;

    /// <summary>Encrypted password.</summary>
    public string PasswordEnc { get; private set; } = string.Empty;

    /// <summary>Creation time, ISO-8601, exactly as the worker wrote it.</summary>
    public string CreatedAt { get; private set; } = string.Empty;

    /// <summary>Last change time, ISO-8601, exactly as the worker wrote it.</summary>
    public string UpdatedAt { get; private set; } = string.Empty;

    /// <summary>Creates an account.</summary>
    /// <param name="id">Account ID.</param>
    /// <param name="projectId">The project it signs in to.</param>
    /// <param name="label">Label, unique within the project.</param>
    /// <param name="username">Sign-in name.</param>
    /// <param name="passwordEnc">Encrypted password.</param>
    /// <param name="createdAt">Creation time.</param>
    /// <param name="updatedAt">Last change time.</param>
    /// <returns>The account.</returns>
    /// <exception cref="DomainValidationException">A value breaks the rules.</exception>
    public static TestAccount Create(
        string id,
        int projectId,
        string label,
        string username,
        string passwordEnc,
        string createdAt,
        string updatedAt)
    {
        new DomainRules()
            .Required(FieldNames.Id, id, "An account needs an ID.")
            .MaxLength(FieldNames.Id, id, DocumentLimits.IdMaxLength)
            .That(FieldNames.ProjectId, projectId > 0, "Choose a project.")
            .Required(FieldNames.Label, label, "Enter a name for this account.")
            .MaxLength(FieldNames.Label, label, DocumentLimits.LabelMaxLength)
            .Required(FieldNames.Username, username, "Enter the username.")
            .MaxLength(FieldNames.Username, username, DocumentLimits.UsernameMaxLength)
            .Required(FieldNames.Secret, passwordEnc, "An account needs a password.")
            .ThrowIfBroken();
        return new TestAccount
        {
            Id = id,
            ProjectId = projectId,
            Label = label,
            Username = username,
            PasswordEnc = passwordEnc,
            CreatedAt = createdAt,
            UpdatedAt = updatedAt,
        };
    }

    /// <summary>Takes on the latest state of the same account.</summary>
    /// <param name="newer">The latest state.</param>
    public void ReplaceWith(TestAccount newer)
    {
        ArgumentNullException.ThrowIfNull(newer);
        ProjectId = newer.ProjectId;
        Label = newer.Label;
        Username = newer.Username;
        PasswordEnc = newer.PasswordEnc;
        UpdatedAt = newer.UpdatedAt;
    }
}
