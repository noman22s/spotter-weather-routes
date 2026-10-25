from datetime import datetime, timedelta, timezone

from django.http import JsonResponse
from rest_framework import serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .services import external, planner


class PlanSerializer(serializers.Serializer):
    origin = serializers.CharField(max_length=200)
    destination = serializers.CharField(max_length=200)
    departure = serializers.DateTimeField(input_formats=["%Y-%m-%dT%H:%M", "%Y-%m-%dT%H:%M:%S", "iso-8601"],
                                          help_text="local time at the origin, e.g. 2026-10-27T08:00")
    load_lbs = serializers.IntegerField(min_value=0, max_value=200000)
    interval_miles = serializers.ChoiceField(choices=[10, 25, 50], default=25)
    heatmap = serializers.BooleanField(default=True)

    def validate_departure(self, value):
        naive = value.replace(tzinfo=None)
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        if naive < now - timedelta(hours=14) or naive > now + timedelta(days=10):
            raise serializers.ValidationError("departure must be within the next 10 days (forecasts cover 16 days)")
        return naive


class PlanView(APIView):
    """POST /api/plan  Three routes with weather risk at every checkpoint, a recommendation
    and a 0-48 h risk heatmap along the corridor."""

    def post(self, request):
        s = PlanSerializer(data=request.data)
        if not s.is_valid():
            return Response({"errors": s.errors}, status=status.HTTP_400_BAD_REQUEST)
        p = s.validated_data
        try:
            body = planner.plan(p["origin"], p["destination"], p["departure"], p["load_lbs"],
                                int(p["interval_miles"]), p["heatmap"])
        except external.ExternalError as e:
            code = status.HTTP_502_BAD_GATEWAY if "failed" in str(e) else status.HTTP_404_NOT_FOUND
            return Response({"error": str(e)}, status=code)
        return Response(body)


class GeocodeView(APIView):
    """GET /api/geocode?q=Den  Place suggestions for the form."""

    def get(self, request):
        q = (request.query_params.get("q") or "").strip()
        if len(q) < 2:
            return Response([])
        try:
            return Response(external.suggest(q))
        except external.ExternalError:
            return Response([])


def health(request):
    return JsonResponse({"ok": True})
