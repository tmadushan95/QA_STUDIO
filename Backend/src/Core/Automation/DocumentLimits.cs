namespace QaStudio.Core.Automation;

/// <summary>Column sizes of the documents the worker owns, shared by their rules and their table mappings.</summary>
public static class DocumentLimits
{
    /// <summary>Longest generated ID.</summary>
    public const int IdMaxLength = 64;

    /// <summary>Longest lifecycle status.</summary>
    public const int StatusMaxLength = 20;

    /// <summary>Longest ISO-8601 time.</summary>
    public const int TimestampMaxLength = 40;

    /// <summary>Longest configuration or provider name, and audit action.</summary>
    public const int NameMaxLength = 100;

    /// <summary>Longest account label or test data name.</summary>
    public const int LabelMaxLength = 200;

    /// <summary>Longest sign-in name: the longest e-mail address is 320 characters.</summary>
    public const int UsernameMaxLength = 320;

    /// <summary>Longest audit target or backup reason.</summary>
    public const int ReasonMaxLength = 400;
}
