from django.urls import path

from . import views

urlpatterns = [
    path("plan", views.PlanView.as_view(), name="plan"),
    path("geocode", views.GeocodeView.as_view(), name="geocode"),
    path("health", views.health, name="health"),
]
