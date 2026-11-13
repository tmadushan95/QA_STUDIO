namespace QaStudio.Core.Automation;

/// <summary>Scenario slots as the worker writes them.</summary>
public static class ScenarioSlotNames
{
    /// <summary>The name of <see cref="ScenarioSlot.Draft"/>.</summary>
    public const string Draft = "draft";

    /// <summary>The name of <see cref="ScenarioSlot.Approved"/>.</summary>
    public const string Approved = "approved";

    /// <summary>The name of a slot.</summary>
    /// <param name="slot">The slot.</param>
    /// <returns>Its name.</returns>
    public static string Of(ScenarioSlot slot) => slot == ScenarioSlot.Draft ? Draft : Approved;

    /// <summary>The slot with a name.</summary>
    /// <param name="name">The name.</param>
    /// <returns>The slot, or null if there is none by that name.</returns>
    public static ScenarioSlot? Parse(string? name) => name switch
    {
        Draft => ScenarioSlot.Draft,
        Approved => ScenarioSlot.Approved,
        _ => null,
    };
}
