using QaStudio.Core.Common;

namespace QaStudio.Core.Automation;

/// <summary>A saved browser session for a test account. Ciphertext only, because it holds sign-in tokens.</summary>
public sealed class AccountSession
{
    private AccountSession()
    {
    }

    /// <summary>The account's ID.</summary>
    public string AccountId { get; private set; } = string.Empty;

    /// <summary>Encrypted browser state.</summary>
    public string StateEnc { get; private set; } = string.Empty;

    /// <summary>When it was saved, ISO-8601.</summary>
    public string SavedAt { get; private set; } = string.Empty;

    /// <summary>Creates a session.</summary>
    /// <param name="accountId">The account's ID.</param>
    /// <param name="stateEnc">Encrypted browser state.</param>
    /// <param name="savedAt">When it was saved.</param>
    /// <returns>The session.</returns>
    /// <exception cref="DomainValidationException">A value breaks the rules.</exception>
    public static AccountSession Create(string accountId, string stateEnc, string savedAt)
    {
        new DomainRules()
            .Required(FieldNames.Id, accountId, "A session needs an account.")
            .MaxLength(FieldNames.Id, accountId, DocumentLimits.IdMaxLength)
            .Required(FieldNames.Secret, stateEnc, "A session needs its browser state.")
            .ThrowIfBroken();
        return new AccountSession { AccountId = accountId, StateEnc = stateEnc, SavedAt = savedAt };
    }

    /// <summary>Takes on a newer session.</summary>
    /// <param name="newer">The newer session.</param>
    public void ReplaceWith(AccountSession newer)
    {
        ArgumentNullException.ThrowIfNull(newer);
        StateEnc = newer.StateEnc;
        SavedAt = newer.SavedAt;
    }
}
