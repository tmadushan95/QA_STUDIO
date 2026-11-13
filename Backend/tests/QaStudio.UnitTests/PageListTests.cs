using QaStudio.Application.Features.Pages.Common;

namespace QaStudio.UnitTests;

/// <summary>The page-list rules, carried over from the worker's own checks when it edited the list.</summary>
public class PageListTests
{
    private static PageEntry Page(string name, string route = "/x", string marker = "") => new(name, route, marker);

    [Fact]
    public void A_good_list_has_no_problems()
    {
        Assert.Empty(PageList.Check([Page("Draft projects", "/projects/draft", "Draft"), Page("Home", "/")]));
    }

    [Fact]
    public void Names_must_be_unique_ignoring_case_and_the_second_one_is_named()
    {
        var problems = PageList.Check([Page("A", "/a"), Page("a", "/b")]);
        Assert.Equal("This name is already used.", problems["pages.1.name"]);
        Assert.Single(problems);
    }

    [Theory]
    [InlineData("")]
    [InlineData(" ")]
    [InlineData("-starts-with-dash")]
    [InlineData("has/slash")]
    public void A_bad_name_is_named(string name) =>
        Assert.Contains("pages.0.name", PageList.Check([Page(name)]).Keys);

    [Theory]
    [InlineData("projects")]
    [InlineData("//evil.example")]
    [InlineData("/has space")]
    [InlineData("")]
    public void A_route_must_be_a_path_on_the_application(string route) =>
        Assert.Contains("pages.0.route", PageList.Check([Page("Ok", route)]).Keys);

    [Fact]
    public void A_long_marker_and_too_many_pages_are_refused()
    {
        Assert.Contains("pages.0.marker", PageList.Check([Page("Ok", "/", new string('m', 201))]).Keys);
        var many = Enumerable.Range(0, PageList.MaxPages + 1).Select(i => Page($"P{i}", $"/p{i}")).ToList();
        Assert.Contains("pages", PageList.Check(many).Keys);
    }

    [Fact]
    public void Spaces_around_values_are_trimmed_before_checking_and_saving()
    {
        Assert.Empty(PageList.Check([Page(" Home ", " / ", " Welcome ")]));
        Assert.Equal(new PageEntry("Home", "/", "Welcome"), PageList.Trimmed([Page(" Home ", " / ", " Welcome ")])[0]);
    }

    [Fact]
    public void The_shared_list_keeps_its_original_block_name_and_a_project_gets_its_own()
    {
        Assert.Equal("pages", PageList.KeyOf(null));
        Assert.Equal("pages:3", PageList.KeyOf(3));
    }

    [Fact]
    public void A_saved_list_round_trips_and_a_missing_or_broken_one_is_empty()
    {
        var pages = new[] { Page("Home", "/", "Hi") };
        Assert.Equal(pages, PageList.Parse(PageList.Serialize(pages)));
        Assert.Empty(PageList.Parse(null));
        Assert.Empty(PageList.Parse("not json"));
        // A page saved without a marker (an older save) reads with an empty one.
        Assert.Equal("", PageList.Parse("""[{"name":"Help","route":"/help"}]""")[0].Marker);
    }
}
