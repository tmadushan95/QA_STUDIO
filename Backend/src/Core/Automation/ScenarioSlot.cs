namespace QaStudio.Core.Automation;

/// <summary>Which of a case's two live scenario records a row is.</summary>
public enum ScenarioSlot
{
    /// <summary>A pending draft, not runnable.</summary>
    Draft = 0,

    /// <summary>The approved version that runs.</summary>
    Approved = 1,
}
